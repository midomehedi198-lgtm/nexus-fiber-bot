'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('./multi_llm_engine');

async function main() {
  for (const [text, intent] of [
    ['slm', 'greeting'], ['سلام', 'greeting'], ['bchhal', 'pricing'],
    ['installation', 'installation'], ['بغيت نهضر مع المسؤول', 'handoff'],
    ['contrat', 'contract'], ['unrelated question xyz', 'unknown']
  ]) assert.equal((await engine.askMultiTierLLM(text)).intent, intent, text);
  assert.equal((await engine.askMultiTierLLM('unrelated question xyz')).needsHuman, true);

  // Exercise real helpers with a fake socket; never open WhatsApp or read auth.
  const source = fs.readFileSync(require.resolve('./real_production_bot'), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const sent = [];
  const context = {
    botSentIds: new Set(), recordLog() {}, setTimeout: callback => callback(),
    Promise, ADMIN_PHONE: '212600000000', saveSessions() {}, askMultiTierLLM: engine.askMultiTierLLM
  };
  vm.createContext(context);
  vm.runInContext(
    section('async function safeReply(', '// ============================================================================\n// 6.') +
    section('async function requestHuman(', 'async function sendLeadAlert('), context
  );
  const sock = {
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, payload) => {
      sent.push({ jid, ...payload });
      return { key: { id: String(sent.length) } };
    }
  };
  const msg = { key: { remoteJid: 'sample@lid' }, message: { conversation: 'need agent' } };
  assert.equal(await context.safeReply(sock, msg, 'reply', '212611111111'), true);
  assert.equal(sent.length, 1, 'one customer reply despite two possible JIDs');
  assert.equal(sent[0].jid, 'sample@lid', 'reply targets original inbound LID');
  const fallbackTargets = [];
  const fallbackSock = { ...sock, sendMessage: async jid => {
    fallbackTargets.push(jid);
    if (jid.endsWith('@lid')) throw new Error('original address unavailable');
    return { key: { id: 'fallback-test' } };
  } };
  assert.equal(await context.safeReply(fallbackSock, msg, 'reply', '212611111111'), true);
  assert.deepEqual(fallbackTargets, ['sample@lid', '212611111111@s.whatsapp.net']);
  const session = { step: 'WAITING_NAME' };
  await context.answerQuestion(sock, msg, session, '212611111111', 'agent');
  assert.equal(sent.length, 3);
  assert.equal(sent[1].jid, '212600000000@s.whatsapp.net');
  assert.ok(sent[1].text.includes('طلب متابعة بشرية'));
  await context.answerQuestion(sock, msg, session, '212611111111', 'agent');
  assert.equal(sent.length, 4, 'handoff alert is debounced');
  const failedSock = { ...sock, sendMessage: async () => { throw new Error('offline'); } };
  const failedSession = {};
  assert.equal(await context.requestHuman(failedSock, msg, failedSession, '', 'failure'), false);
  assert.equal(failedSession.lastHandoff, undefined, 'failed alert remains retryable');
  console.log('PASS: Arabic/Latin intents, unknown escalation, single reply, admin handoff, debounce, failed alert retry.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
