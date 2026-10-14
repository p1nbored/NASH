import type { ComponentProps, ReactNode } from 'react'
import { Pressable, View } from 'react-native'

// A held press selects text natively; claiming it keeps that release from counting as a tap.
function ignoreLongPress(): void {}

/** A message body that opens the actions sheet on long press (Android, which has no inline
 *  selection) or reveals its copy button on tap (platforms with inline selection). */
export function MobileNativeChatLongPressContent({
  onLongPress,
  onPress,
  style,
  children
}: {
  onLongPress?: () => void
  onPress?: () => void
  style: ComponentProps<typeof View>['style']
  children: ReactNode
}): React.JSX.Element {
  return onLongPress || onPress ? (
    // Not one accessible element: screen readers keep reaching the text and controls inside.
    <Pressable
      onLongPress={onLongPress ?? ignoreLongPress}
      onPress={onPress}
      accessible={false}
      style={style}
    >
      {children}
    </Pressable>
  ) : (
    <View style={style}>{children}</View>
  )
}
