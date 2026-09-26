import { describe, expect, it } from 'vitest';
import { MAX_MEDIA_BYTES, mediaType, validateMedia } from './media';

describe('media validation', () => {
  it('supports common photos, recordings and movies without treating scripts as media', async () => {
    expect(mediaType('相片.HEIC')?.kind).toBe('image');
    expect(mediaType('录音.m4a')?.kind).toBe('audio');
    expect(mediaType('视频.mov')?.kind).toBe('video');
    expect(mediaType('example.svg')).toBeNull();
    await expect(validateMedia(new Blob(['<html>not an image']), 'image.png')).rejects.toThrow('内容与文件格式不符');
    await expect(validateMedia(new Blob([]), 'empty.mp4')).rejects.toThrow('0 字节');
    await expect(validateMedia({ size: MAX_MEDIA_BYTES + 1 } as Blob, 'large.mp4')).rejects.toThrow('1 GB');
    await expect(validateMedia({ size: 75 * 1024 * 1024 } as Blob, 'photo.png')).rejects.toThrow('75.0 MB');
    const largeVideo = { size: 75 * 1024 * 1024, slice: () => new Blob(['\x00\x00\x00\x18ftypisom']) } as unknown as Blob;
    await expect(validateMedia(largeVideo, 'video.mp4')).resolves.toMatchObject({ kind: 'video' });
    await expect(validateMedia(new Blob(['RIFF\x00\x00\x00\x00WAVE']), 'audio.wav')).resolves.toMatchObject({ kind: 'audio' });
  });
});
