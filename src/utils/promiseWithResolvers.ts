export const promiseWithResolvers =
  // @ts-expect-error TODO: replace with `Promise.withResolvers()` once it lands in node
  Promise.withResolvers?.bind(Promise) ||
  function promiseWithResolvers<T>() {
    let resolve!: (t: T) => void
    let reject!: (err: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return {promise, reject, resolve}
  }
