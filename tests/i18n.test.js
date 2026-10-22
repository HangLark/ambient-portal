import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, dictionaries, saveLanguage, translate } from '../src/i18n.js';

test('every interface and error key exists in both languages', () => {
  assert.deepEqual(Object.keys(dictionaries['en-US']).sort(), Object.keys(dictionaries['zh-CN']).sort());
  for (const dictionary of Object.values(dictionaries)) assert.ok(Object.values(dictionary).every((value) => typeof value === 'string' && value.trim()));
});

test('stored language takes priority; browser language provides the fallback', () => {
  assert.equal(detectLanguage({ getItem: () => 'en-US' }, ['zh-CN']), 'en-US');
  assert.equal(detectLanguage(null, ['zh-TW']), 'zh-CN');
  assert.equal(detectLanguage(null, ['fr-FR']), 'en-US');
  assert.equal(detectLanguage({ getItem: () => 'invalid' }, ['zh-CN']), 'zh-CN');
});

test('blocked storage never prevents boot or language switching', () => {
  const blocked = { getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('Storage blocked'); } };
  assert.equal(detectLanguage(blocked, ['zh-CN']), 'zh-CN');
  assert.doesNotThrow(() => saveLanguage(blocked, 'en-US'));
  assert.equal(translate('zh-CN', 'camera'), '摄像头');
});
