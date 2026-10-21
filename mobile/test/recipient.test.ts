import test from 'node:test';
import assert from 'node:assert';
import { recipientError } from '../src/recipient';

test('Ovanova accounts must use an @ovanova.co recipient', () => {
  assert.equal(recipientError('sugar@ovanova.co', true), null);
  assert.equal(recipientError('ap@ovanova.co', true), null);
  assert.match(recipientError('me@gmail.com', true)!, /@ovanova\.co/);
  assert.match(recipientError('', true)!, /@ovanova\.co/);
});

test('other accounts may leave it blank or use any address, but not Sugar', () => {
  assert.equal(recipientError('', false), null);
  assert.equal(recipientError('books@kellow.com', false), null);
  assert.ok(recipientError('sugar@ovanova.co', false));
  assert.ok(recipientError('not-an-email', false));
});
