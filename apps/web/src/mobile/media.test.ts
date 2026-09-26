import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkMediaStorage, mediaType, validateMedia } from './media';

describe('media validation', () => {
  it('supports common photos, recordings and movies without treating scripts as media', async () => {
    expect(mediaType('相片.HEIC')?.kind).toBe('image');
    expect(mediaType('录音.m4a')?.kind).toBe('audio');
    expect(mediaType('视频.mov')?.kind).toBe('video');
    expect(mediaType('example.svg')).toBeNull();
    await expect(validateMedia(new Blob(['<html>not an image']), 'image.png')).rejects.toThrow('内容与文件格式不符');
    await expect(validateMedia(new Blob([]), 'empty.mp4')).rejects.toThrow('0 字节');
    await expect(validateMedia({ size: Number.NaN } as Blob, 'large.mp4')).rejects.toThrow();
    const largeVideo = { size: Math.round(1715.6 * 1024 * 1024), slice: () => new Blob(['\x00\x00\x00\x18ftypisom']) } as unknown as Blob;
    await expect(validateMedia(largeVideo, 'video.mp4')).resolves.toMatchObject({ kind: 'video' });
    const largeImage = { size: 75 * 1024 * 1024, slice: () => new Blob([new Uint8Array([137,80,78,71,13,10,26,10])]) } as unknown as Blob;
    await expect(validateMedia(largeImage, 'image.png')).resolves.toMatchObject({ kind: 'image' });
    await expect(validateMedia(new Blob(['RIFF\x00\x00\x00\x00WAVE']), 'audio.wav')).resolves.toMatchObject({ kind: 'audio' });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('checks available browser storage instead of a fixed file limit', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 10 * 1024 ** 3, usage: 1024 ** 3 }) } });
    await expect(checkMediaStorage(3 * 1024 ** 3)).resolves.toBeUndefined();
    await expect(checkMediaStorage(10 * 1024 ** 3)).rejects.toThrow('浏览器可用存储空间不足');
    vi.stubGlobal('navigator', {});
    await expect(checkMediaStorage(3 * 1024 ** 3)).resolves.toBeUndefined();
  });
});
