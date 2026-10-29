// One report must name one folder in both OSC 7 parsers: the daemon's (checkpoints, restores) and
// the renderer's (split, new terminal). Each side's tests run these cases, including what nushell
// sends raw.
export const OSC7_PARSER_AGREEMENT_CASES: readonly [string, string, string | null][] = [
  ['a raw tab', 'file://Desktop/tmp/a\tb', '/tmp/a\tb'],
  ['a raw newline', 'file://Desktop/tmp/a\nb', '/tmp/a\nb'],
  ['a raw carriage return', 'file://Desktop/tmp/a\rb', '/tmp/a\rb'],
  ['a trailing space', 'file://Desktop/tmp/a ', '/tmp/a '],
  ['a space inside', 'file://Desktop/tmp/a b', '/tmp/a b'],
  ['a lone %', 'file://Desktop/tmp/100%', '/tmp/100%'],
  ['a # and ?', 'file://Desktop/tmp/h#a?b', '/tmp/h#a?b'],
  ['an encoded newline', 'file:///tmp/a%0Ab', '/tmp/a\nb'],
  ['a leading raw NUL', 'file:///\u0000tmp', null],
  ['a trailing raw NUL', 'file:///tmp/a\u0000', null],
  ['an encoded NUL', 'file:///tmp/%00', null],
  ['non-UTF-8 hex', 'file:///tmp/%FF', null]
]
