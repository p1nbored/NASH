import { useCallback, useLayoutEffect, useRef, useState } from 'react'

// Why slack: subpixel scroll positions never land exactly on the bottom.
const FOLLOW_SLACK_PX = 24

/** Keeps the newest output in view until the user scrolls up; Jump to latest resumes following. */
export function useTranscriptFollow(contentVersion: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [following, setFollowing] = useState(true)

  const onScroll = useCallback((): void => {
    const element = scrollRef.current
    if (element) {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      setFollowing(distance <= FOLLOW_SLACK_PX)
    }
  }, [])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (following && element) {
      element.scrollTop = element.scrollHeight
    }
  }, [contentVersion, following])

  const jumpToLatest = useCallback((): void => {
    const element = scrollRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
    setFollowing(true)
  }, [])

  return { scrollRef, following, onScroll, jumpToLatest }
}
