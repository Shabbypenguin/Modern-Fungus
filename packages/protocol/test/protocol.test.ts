import { describe, expect, it } from 'vitest';
import { cleanCode, cleanName, defaultRoomSettings, parseClientMessage, validateSettings } from '../src/index.js';

describe('message validation', () => {
  it('accepts well-formed messages', () => {
    expect(parseClientMessage('{"t":"hello","v":1,"name":"Shabby"}')).toEqual({ t: 'hello', v: 1, name: 'Shabby', token: undefined });
    expect(parseClientMessage('{"t":"act","seq":3,"action":{"type":"place","rotation":1,"r":4,"c":5}}')?.t).toBe('act');
    expect(parseClientMessage('{"t":"act","seq":3,"action":{"type":"bite","cells":[{"r":1,"c":2}]}}')?.t).toBe('act');
  });
  it('rejects junk, oversize, unknown and forged messages', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('[]')).toBeNull();
    expect(parseClientMessage('{"t":"nope"}')).toBeNull();
    expect(parseClientMessage('x'.repeat(20000))).toBeNull();
    // Humans may not send the classic CPU's multi-cell grow.
    expect(parseClientMessage('{"t":"act","seq":0,"action":{"type":"grow","cells":[{"r":1,"c":1}]}}')).toBeNull();
    expect(parseClientMessage('{"t":"act","seq":0,"action":{"type":"bite","cells":[]}}')).toBeNull();
    expect(parseClientMessage('{"t":"act","seq":-1,"action":{"type":"pass"}}')).toBeNull();
    expect(parseClientMessage('{"t":"emote","id":"<script>"}')).toBeNull();
    expect(parseClientMessage('{"t":"sit","seat":99}')).toBeNull();
  });
  it('validates room settings', () => {
    expect(validateSettings(defaultRoomSettings())).toBeNull();
    expect(validateSettings({ ...defaultRoomSettings(), boardSize: 21 })).toMatch(/board/);
    expect(validateSettings({ ...defaultRoomSettings(), turnTimeLimit: 2 })).toMatch(/turn/);
    expect(validateSettings({ ...defaultRoomSettings(), seats: ['open', 'open'] })).toMatch(/classic/);
    const modern = { ...defaultRoomSettings(), rules: 'modern', seats: Array(16).fill('open') };
    expect(validateSettings(modern)).toMatch(/too small/);
    expect(validateSettings({ ...modern, boardSize: 50 })).toBeNull();
    expect(validateSettings({ ...modern, boardSize: 50, seats: ['open', 'closed'] })).toMatch(/closed/);
  });
});

describe('cleaning', () => {
  it('names: trimmed, collapsed, control and zero-width characters removed, capped', () => {
    expect(cleanName('  Shab​by  \n ')).toBe('Shabby');
    expect(cleanName('a   b')).toBe('a b');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42)).toBeNull();
  });
  it('room codes: 4 unambiguous letters, case-insensitive', () => {
    expect(cleanCode('kzpt')).toBe('KZPT');
    expect(cleanCode('KZP0')).toBeNull();
    expect(cleanCode('KZPTX')).toBeNull();
  });
});
