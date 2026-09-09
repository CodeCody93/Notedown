/**
 * Vitest setup: minimal DOMMatrix/Path2D shims for the pdfjs-dist main-thread
 * build. pdfjs evaluates `new DOMMatrix()` at module scope (its SCALE_MATRIX
 * constant), but neither Node nor jsdom provide DOMMatrix — so importing
 * 'pdfjs-dist' in tests throws `ReferenceError: DOMMatrix is not defined`.
 * Production is unaffected (real browsers and the Tauri webview ship
 * DOMMatrix natively).
 *
 * Text extraction (`getTextContent`) and vector analysis (`getOperatorList`)
 * never render to a 2D canvas, so this stub only needs to exist and implement
 * basic 2D matrix plumbing sanely — it is never on a rendering path.
 */

class MinimalDOMMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number

  constructor(init?: number[] | string) {
    this.a = 1
    this.b = 0
    this.c = 0
    this.d = 1
    this.e = 0
    this.f = 0
    if (Array.isArray(init) && init.length >= 6) {
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = init
      this.a = a
      this.b = b
      this.c = c
      this.d = d
      this.e = e
      this.f = f
    }
    // String (CSS transform) init is accepted and ignored — tests never
    // exercise it; matches the "never on a rendering path" contract above.
  }

  multiplySelf(other: MinimalDOMMatrix): this {
    const { a, b, c, d, e, f } = this
    this.a = a * other.a + c * other.b
    this.b = b * other.a + d * other.b
    this.c = a * other.c + c * other.d
    this.d = b * other.c + d * other.d
    this.e = a * other.e + c * other.f + e
    this.f = b * other.e + d * other.f + f
    return this
  }

  preMultiplySelf(other: MinimalDOMMatrix): this {
    const { a, b, c, d, e, f } = other
    const t = { a, b, c, d, e, f }
    other.a = this.a
    other.b = this.b
    other.c = this.c
    other.d = this.d
    other.e = this.e
    other.f = this.f
    this.a = t.a
    this.b = t.b
    this.c = t.c
    this.d = t.d
    this.e = t.e
    this.f = t.f
    return this.multiplySelf(other)
  }

  translateSelf(tx = 0, ty = 0): this {
    this.e += tx * this.a + ty * this.c
    this.f += tx * this.b + ty * this.d
    return this
  }

  scaleSelf(sx = 1, sy = sx): this {
    this.a *= sx
    this.b *= sx
    this.c *= sy
    this.d *= sy
    return this
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c
    if (det === 0) return this
    const { a, b, c, d, e, f } = this
    this.a = d / det
    this.b = -b / det
    this.c = -c / det
    this.d = a / det
    this.e = (c * f - d * e) / det
    this.f = (b * e - a * f) / det
    return this
  }

  toFloat64Array(): Float64Array {
    // 4x4 column-major form pdfjs expects from real DOMMatrix.
    return new Float64Array([
      this.a, this.b, 0, 0,
      this.c, this.d, 0, 0,
      0, 0, 1, 0,
      this.e, this.f, 0, 1,
    ])
  }

  toFloat32Array(): Float32Array {
    return Float32Array.from(this.toFloat64Array())
  }

  toJSON(): Record<string, number> {
    return { a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f }
  }

  toString(): string {
    return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`
  }

  static fromMatrix(other: { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }): MinimalDOMMatrix {
    const m = new MinimalDOMMatrix()
    if (other.a !== undefined) m.a = other.a
    if (other.b !== undefined) m.b = other.b
    if (other.c !== undefined) m.c = other.c
    if (other.d !== undefined) m.d = other.d
    if (other.e !== undefined) m.e = other.e
    if (other.f !== undefined) m.f = other.f
    return m
  }

  static fromFloat32Array(arr: ArrayLike<number>): MinimalDOMMatrix {
    return new MinimalDOMMatrix(Array.from(arr).slice(0, 6))
  }

  static fromFloat64Array(arr: ArrayLike<number>): MinimalDOMMatrix {
    return MinimalDOMMatrix.fromFloat32Array(arr)
  }
}

class MinimalPath2D {
  constructor(_path?: unknown) {
    // Accepted and ignored — never on a rendering path in tests.
  }
  addPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  arc(): void {}
  arcTo(): void {}
  ellipse(): void {}
  rect(): void {}
  roundRect(): void {}
}

const g = globalThis as Record<string, unknown>
if (g['DOMMatrix'] === undefined) g['DOMMatrix'] = MinimalDOMMatrix
if (g['Path2D'] === undefined) g['Path2D'] = MinimalPath2D
