// Checks for src/security.ts: the token is the only secret the app handles, so
// reject values that could break an Authorization header or hide characters.
import { MAX_TOKEN_LENGTH, tokenInputError } from '../src/security'
import { assertUpUrl } from '../src/up'

let ok = true
function check(label: string, condition: boolean) {
  ok = ok && condition
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
}

check('normal token accepted', tokenInputError('up:yeah:abcDEF123_-') === null)
check('pasted surrounding whitespace trimmed', tokenInputError('  up:yeah:abc  ') === null)
check('empty rejected', tokenInputError('') !== null)
check('internal space rejected', tokenInputError('up:yeah:abc def') !== null)
check('internal newline rejected', tokenInputError('up:yeah:abc\ndef') !== null)
check('NUL rejected', tokenInputError('up:yeah:abc\u0000') !== null)
check('max length accepted', tokenInputError('x'.repeat(MAX_TOKEN_LENGTH)) === null)
check('over max length rejected', tokenInputError('x'.repeat(MAX_TOKEN_LENGTH + 1)) !== null)

function rejectsUrl(url: string): boolean {
  try {
    assertUpUrl(url)
    return false
  } catch {
    return true
  }
}

check(
  'Up API URL accepted',
  assertUpUrl('https://api.up.com.au/api/v1/accounts') ===
    'https://api.up.com.au/api/v1/accounts',
)
check('foreign origin rejected', rejectsUrl('https://evil.example/steal'))
check('lookalike origin rejected', rejectsUrl('https://api.up.com.au.evil.example/x'))
check('plain HTTP rejected', rejectsUrl('http://api.up.com.au/api/v1/accounts'))
check('protocol-relative URL rejected', rejectsUrl('//evil.example/x'))

console.log('\nRESULT:', ok ? 'ALL PASS' : 'FAILURES')
if (!ok) process.exit(1)
