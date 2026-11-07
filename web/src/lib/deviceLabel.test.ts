import { deviceLabel } from '@/lib/deviceLabel';

const ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; SM-G780G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const LINUX_CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0';
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0';

describe('deviceLabel', () => {
  it.each([
    [ANDROID_PHONE, { kind: 'phone', name: 'Chrome · Android' }],
    [ANDROID_TABLET, { kind: 'tablet', name: 'Chrome · Android' }],
    [IPHONE, { kind: 'phone', name: 'Safari · iOS' }],
    [LINUX_CHROME, { kind: 'computer', name: 'Chrome · Linux' }],
    [WINDOWS_EDGE, { kind: 'computer', name: 'Edge · Windows' }],
    [MAC_FIREFOX, { kind: 'computer', name: 'Firefox · macOS' }],
    ['', { kind: 'computer', name: '?' }],
    ['curl/8.5', { kind: 'computer', name: '?' }],
  ])('labels %s', (userAgent, expected) => {
    expect(deviceLabel(userAgent)).toEqual(expected);
  });
});
