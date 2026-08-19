/** MathJax is loaded from /public as a plain script, so it has no module type. */
declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (elements: HTMLElement[]) => Promise<void>
      typesetClear?: (elements: HTMLElement[]) => void
      startup?: { promise: Promise<void> }
    }
  }
}

/** Typeset one container. Safe to call before MathJax has finished loading. */
export async function typeset(element: HTMLElement): Promise<void> {
  const mathjax = window.MathJax
  if (!mathjax?.typesetPromise) return
  try {
    await mathjax.startup?.promise
    mathjax.typesetClear?.([element])
    await mathjax.typesetPromise([element])
  } catch (error) {
    // A typeset failure must not blank the question.
    console.error('MathJax typeset failed', error)
  }
}

export {}
