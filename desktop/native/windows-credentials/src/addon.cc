// One Windows generic credential at a time, by exact target name, for NASH.
//
// NASH reads and writes agy's own login item (target `gemini:antigravity`) to switch
// Antigravity accounts, as the macOS adapter does with agy's Keychain item. The surface is
// deliberately narrow: CredReadW/CredWriteW for CRED_TYPE_GENERIC by exact target, no
// enumeration, no other credential type, and a delete that refuses every target outside the
// disposable `nash-test:` namespace the real-store test uses. Failures report only the Win32
// error code; nothing here formats a system message, logs, or echoes a credential blob.

#include <napi.h>
#include <windows.h>
#include <wincred.h>

#include <string>

namespace {

bool IsValidTarget(const std::u16string& target) {
  return !target.empty() && target.size() <= CRED_MAX_GENERIC_TARGET_NAME_LENGTH &&
         target.find(u'\0') == std::u16string::npos;
}

bool IsValidPersist(uint32_t persist) {
  return persist == CRED_PERSIST_SESSION || persist == CRED_PERSIST_LOCAL_MACHINE ||
         persist == CRED_PERSIST_ENTERPRISE;
}

Napi::Value Fail(Napi::Env env, const char* usage) {
  Napi::TypeError::New(env, usage).ThrowAsJavaScriptException();
  return env.Null();
}

Napi::Object StatusResult(Napi::Env env, const char* status) {
  auto result = Napi::Object::New(env);
  result.Set("status", Napi::String::New(env, status));
  return result;
}

Napi::Object ErrorResult(Napi::Env env, DWORD code) {
  auto result = StatusResult(env, "error");
  result.Set("code", Napi::Number::New(env, static_cast<double>(code)));
  return result;
}

// readGenericCredential(target) -> { status: 'found', blob, userName, persist }
//   | { status: 'missing' } | { status: 'error', code }
Napi::Value ReadGenericCredential(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  constexpr const char* kUsage = "readGenericCredential(target: string)";
  if (info.Length() < 1 || !info[0].IsString()) {
    return Fail(env, kUsage);
  }
  auto target = info[0].As<Napi::String>().Utf16Value();
  if (!IsValidTarget(target)) {
    return Fail(env, kUsage);
  }

  PCREDENTIALW credential = nullptr;
  if (!CredReadW(reinterpret_cast<LPCWSTR>(target.c_str()), CRED_TYPE_GENERIC, 0, &credential)) {
    const DWORD code = GetLastError();
    return code == ERROR_NOT_FOUND ? StatusResult(env, "missing") : ErrorResult(env, code);
  }

  const DWORD size = credential->CredentialBlobSize;
  if (size > CRED_MAX_CREDENTIAL_BLOB_SIZE || (size > 0 && credential->CredentialBlob == nullptr)) {
    CredFree(credential);
    return ErrorResult(env, ERROR_INVALID_DATA);
  }

  auto result = StatusResult(env, "found");
  // Copy, never wrap: Electron's V8 sandbox refuses external buffers.
  result.Set("blob", size > 0 ? Napi::Buffer<uint8_t>::Copy(env, credential->CredentialBlob, size)
                              : Napi::Buffer<uint8_t>::New(env, 0));
  result.Set("userName",
             credential->UserName != nullptr
                 ? Napi::Value(Napi::String::New(
                       env, reinterpret_cast<const char16_t*>(credential->UserName)))
                 : env.Null());
  result.Set("persist", Napi::Number::New(env, static_cast<double>(credential->Persist)));

  if (size > 0) {
    SecureZeroMemory(credential->CredentialBlob, size);
  }
  CredFree(credential);
  return result;
}

// writeGenericCredential(target, userName, blob, persist) -> { status: 'ok' } | { status: 'error', code }
// Replaces the whole item; the caller passes the existing item's user name and persistence.
Napi::Value WriteGenericCredential(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  constexpr const char* kUsage =
      "writeGenericCredential(target: string, userName: string | null, blob: Uint8Array, "
      "persist: number)";
  if (info.Length() < 4 || !info[0].IsString() || !(info[1].IsString() || info[1].IsNull()) ||
      !info[2].IsTypedArray() || !info[3].IsNumber()) {
    return Fail(env, kUsage);
  }
  auto target = info[0].As<Napi::String>().Utf16Value();
  if (!IsValidTarget(target)) {
    return Fail(env, kUsage);
  }
  const bool hasUserName = info[1].IsString();
  auto userName = hasUserName ? info[1].As<Napi::String>().Utf16Value() : std::u16string();
  if (userName.size() > CRED_MAX_USERNAME_LENGTH || userName.find(u'\0') != std::u16string::npos) {
    return Fail(env, kUsage);
  }
  auto typed = info[2].As<Napi::TypedArray>();
  if (typed.TypedArrayType() != napi_uint8_array) {
    return Fail(env, kUsage);
  }
  auto blob = info[2].As<Napi::Uint8Array>();
  const size_t size = blob.ByteLength();
  if (size > CRED_MAX_CREDENTIAL_BLOB_SIZE) {
    return Fail(env, kUsage);
  }
  // Range-check the double before converting: an out-of-range cast is undefined behaviour.
  const double persistNumber = info[3].As<Napi::Number>().DoubleValue();
  if (!(persistNumber >= CRED_PERSIST_SESSION && persistNumber <= CRED_PERSIST_ENTERPRISE)) {
    return Fail(env, kUsage);
  }
  const uint32_t persist = static_cast<uint32_t>(persistNumber);
  if (static_cast<double>(persist) != persistNumber || !IsValidPersist(persist)) {
    return Fail(env, kUsage);
  }

  CREDENTIALW credential = {};
  credential.Type = CRED_TYPE_GENERIC;
  credential.TargetName = reinterpret_cast<LPWSTR>(target.data());
  credential.CredentialBlobSize = static_cast<DWORD>(size);
  credential.CredentialBlob = size > 0 ? blob.Data() : nullptr;
  credential.Persist = persist;
  credential.UserName = hasUserName ? reinterpret_cast<LPWSTR>(userName.data()) : nullptr;

  if (!CredWriteW(&credential, 0)) {
    return ErrorResult(env, GetLastError());
  }
  return StatusResult(env, "ok");
}

// deleteTestCredential(target) -> { status: 'ok' } | { status: 'missing' } | { status: 'error', code }
// Test cleanup only: anything outside the `nash-test:` namespace is refused before CredDeleteW.
Napi::Value DeleteTestCredential(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  constexpr const char* kUsage = "deleteTestCredential(target: `nash-test:${string}`)";
  static const std::u16string kTestPrefix = u"nash-test:";
  if (info.Length() < 1 || !info[0].IsString()) {
    return Fail(env, kUsage);
  }
  auto target = info[0].As<Napi::String>().Utf16Value();
  if (!IsValidTarget(target) || target.size() <= kTestPrefix.size() ||
      target.compare(0, kTestPrefix.size(), kTestPrefix) != 0) {
    return Fail(env, kUsage);
  }
  if (!CredDeleteW(reinterpret_cast<LPCWSTR>(target.c_str()), CRED_TYPE_GENERIC, 0)) {
    const DWORD code = GetLastError();
    return code == ERROR_NOT_FOUND ? StatusResult(env, "missing") : ErrorResult(env, code);
  }
  return StatusResult(env, "ok");
}

}  // namespace

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("readGenericCredential", Napi::Function::New(env, ReadGenericCredential));
  exports.Set("writeGenericCredential", Napi::Function::New(env, WriteGenericCredential));
  exports.Set("deleteTestCredential", Napi::Function::New(env, DeleteTestCredential));
  return exports;
}

NODE_API_MODULE(orca_windows_credentials, Init)
