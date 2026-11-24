import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, detectLanguage, escapeLike, makeTitle } from '../src/utils/text.js';

test('countWords handles Hindi, English and mixed text', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords('Hello world'), 2);
  assert.equal(countWords('मुझे कल meeting में जाना है'), 6);
  assert.equal(countWords('hello , world'), 2); // lone punctuation is not a word
});

test('detectLanguage classifies by script', () => {
  assert.equal(detectLanguage('This is English only'), 'en');
  assert.equal(detectLanguage('यह पूरी तरह हिंदी में है'), 'hi');
  assert.equal(detectLanguage('मुझे कल office जाना है for the meeting'), 'mixed');
  assert.equal(detectLanguage('12345 !!!'), 'other');
});

test('makeTitle truncates on a word boundary', () => {
  assert.equal(makeTitle('Short note'), 'Short note');
  const long = 'This is a fairly long transcription that should be cut nicely at a word boundary';
  const title = makeTitle(long, 40);
  assert.ok(title.endsWith('…'));
  assert.ok(title.length <= 41);
  assert.equal(makeTitle('   '), 'Untitled transcription');
});

test('escapeLike escapes SQL wildcards', () => {
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});
