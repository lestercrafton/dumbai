import test from 'node:test';
import assert from 'node:assert';
import { statusOf, summaryMeta } from '../src/status';

const b = (o: any = {}) => ({ category: 'business' as const, action: 'batch' as const, serverStatus: null, ...o });

test('the server verdict wins; the driver choice stands in until it arrives', () => {
  assert.equal(statusOf(b(), false), 'queued');
  assert.equal(statusOf(b({ action: 'send' }), false), 'reimbursable');
  assert.equal(statusOf(b(), true), 'log only');
  assert.equal(statusOf(b({ serverStatus: 'sent' }), false), 'sent');
  assert.equal(statusOf(b({ serverStatus: 'log only' }), false), 'log only');
  assert.equal(statusOf({ category: null, action: null, serverStatus: null }, false), 'untagged');
});

test('personal trips never show money or a send state, even if the server once said otherwise', () => {
  const p = { category: 'personal' as const, action: null, serverStatus: 'reimbursable', amount: 9 };
  assert.equal(statusOf(p, false), 'personal'); assert.equal(summaryMeta(p, 'personal'), '');
});

test('summary lines match the web page', () => {
  assert.equal(summaryMeta(b({ amount: 11.32 }), 'queued'), 'Friday batch · $11.32');
  assert.equal(summaryMeta(b({ serverStatus: 'sent', amount: 11.32, reimbursedAt: '2026-10-21T20:00:00Z' }), 'sent'), 'Sent Oct 21 · $11.32');
  assert.equal(summaryMeta(b({ action: 'send', synced: 1, amount: 2 }), 'reimbursable'), 'Not sent yet · $2.00');
  assert.equal(summaryMeta(b({ action: 'send', synced: 0 }), 'reimbursable'), 'Sending now');
  assert.equal(summaryMeta(b(), 'log only'), 'Logged · company car');
});
