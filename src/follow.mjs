export function createTranscriptFollower() {
  let following = true
  let previous
  let unread = 0
  let lastTop
  return {
    scroll(element) {
      if (following && element.scrollTop === lastTop) return { following, unread }
      following = element.scrollHeight - element.clientHeight - element.scrollTop <= 80
      if (following) unread = 0
      return { following, unread }
    },
    update(element, ids) {
      if (previous && !following) unread += ids.filter(id => !previous.has(id)).length
      previous = new Set(ids)
      if (following) { element.scrollTop = element.scrollHeight; lastTop = element.scrollTop }
      return { following, unread }
    },
    jump(element) {
      following = true
      unread = 0
      element.scrollTop = element.scrollHeight
      lastTop = element.scrollTop
    }
  }
}
