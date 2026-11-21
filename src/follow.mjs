export function jumpLabel(following, unread, saved, distance) {
  if (following || distance <= 80) return ''
  return saved || !unread ? '跳至底部 / Jump to bottom' : `跳到最新 / Latest · ${unread} 則新字幕 / new captions`
}

export function createTranscriptFollower() {
  let following = true
  let previous
  let unread = 0
  let lastTop
  let anchor
  const remember = element => {
    const top = element.getBoundingClientRect?.().top || 0
    const row = [...element.querySelectorAll?.('.segment') || []].find(row => row.getBoundingClientRect().bottom > top + (element.clientTop || 0))
    anchor = row ? { row, offset: row.getBoundingClientRect().top - top } : undefined
  }
  return {
    scroll(element) {
      if (element.scrollTop === lastTop) return { following, unread }
      following = element.scrollHeight - element.clientHeight - element.scrollTop <= 80
      if (following) unread = 0
      if (following) anchor = undefined
      else remember(element)
      return { following, unread }
    },
    update(element, ids) {
      if (previous && !following) unread += ids.filter(id => !previous.has(id)).length
      previous = new Set(ids)
      if (following) { element.scrollTop = element.scrollHeight; lastTop = element.scrollTop }
      else {
        if (anchor?.row.isConnected && element.contains(anchor.row)) {
          element.scrollTop += anchor.row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset
          lastTop = element.scrollTop
        }
        remember(element)
      }
      return { following, unread }
    },
    jump(element) {
      following = true
      unread = 0
      anchor = undefined
      element.scrollTop = element.scrollHeight
      lastTop = element.scrollTop
    }
  }
}
