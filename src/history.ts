import { useCallback, useRef, useState } from 'react'
import { newDocument, type EditDocument } from './engine/model'

export function useEditHistory() {
  const [doc, setDoc] = useState<EditDocument>(newDocument)
  const current = useRef(doc),
    past = useRef<EditDocument[]>([]),
    future = useRef<EditDocument[]>([]),
    start = useRef<EditDocument | null>(null)
  const [revision, setRevision] = useState(0)
  const publish = useCallback((next: EditDocument) => {
    current.current = next
    setDoc(next)
    setRevision((v) => v + 1)
  }, [])
  const begin = useCallback(() => {
    if (!start.current) start.current = current.current
  }, [])
  const commit = useCallback(() => {
    if (start.current && JSON.stringify(start.current) !== JSON.stringify(current.current)) {
      past.current = [...past.current.slice(-79), start.current]
      future.current = []
    }
    start.current = null
    setRevision((v) => v + 1)
  }, [])
  const update = useCallback(
    (fn: (d: EditDocument) => EditDocument, transient = false) => {
      if (!transient) {
        if (start.current) commit()
        past.current = [...past.current.slice(-79), current.current]
        future.current = []
      } else if (!start.current) start.current = current.current
      publish(fn(current.current))
    },
    [commit, publish],
  )
  const undo = useCallback(() => {
    commit()
    const previous = past.current.pop()
    if (!previous) return
    future.current.push(current.current)
    publish(previous)
  }, [commit, publish])
  const redo = useCallback(() => {
    commit()
    const next = future.current.pop()
    if (!next) return
    past.current.push(current.current)
    publish(next)
  }, [commit, publish])
  const reset = useCallback(
    (next: EditDocument) => {
      past.current = []
      future.current = []
      start.current = null
      publish(next)
    },
    [publish],
  )
  return {
    doc,
    current,
    update,
    begin,
    commit,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0 || !!start.current,
    canRedo: future.current.length > 0,
    revision,
  }
}
