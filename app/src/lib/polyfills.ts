/**
 * Small polyfills for APIs pdf.js v6 (and our code) assume but that older
 * Safari/JavaScriptCore lacks. Without these, loading pdf.js throws
 * "undefined is not a function" on Safari < 17.4, which surfaced as a
 * failed PDF upload. Importing this module for its side effects installs
 * them; it is a no-op on browsers that already have the APIs.
 */

// Promise.withResolvers — Safari 17.4+, used internally by pdf.js
if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
  ;(Promise as unknown as { withResolvers: () => unknown }).withResolvers = function () {
    let resolve!: (value: unknown) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// Array.prototype.at / String.prototype.at — Safari 15.4+
for (const proto of [Array.prototype, String.prototype] as Array<{ at?: unknown }>) {
  if (typeof proto.at !== 'function') {
    Object.defineProperty(proto, 'at', {
      value: function (this: { length: number; [k: number]: unknown }, n: number) {
        n = Math.trunc(n) || 0
        if (n < 0) n += this.length
        return n < 0 || n >= this.length ? undefined : this[n]
      },
      writable: true,
      configurable: true,
    })
  }
}
