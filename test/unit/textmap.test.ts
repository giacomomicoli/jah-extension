// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TextMap } from '../../src/content/textmap';

function mapOf(html: string): TextMap {
  document.body.innerHTML = html;
  return new TextMap(document.body);
}

const compact = (text: string) => text.replace(/\s+/g, '');

describe('TextMap normalization', () => {
  it('collapses whitespace inside and across text nodes', () => {
    expect(mapOf('<p>  Hello   \n\t world  </p>').text).toBe('Hello world ');
    expect(mapOf('<p>Hello <b> big </b> world</p>').text).toBe('Hello big world');
  });

  it('separates blocks and line breaks but not inline elements', () => {
    expect(mapOf('<p>foo</p><p>bar</p>').text).toBe('foo bar');
    expect(mapOf('<div>foo<br>bar</div>').text).toBe('foo bar');
    expect(mapOf('<p><b>foo</b>bar</p>').text).toBe('foobar');
    expect(mapOf('<ul><li>one</li><li>two</li></ul>').text).toBe('one two');
    expect(mapOf('<div><p>foo</p>bar</div>').text).toBe('foo bar');
  });

  it('skips non-content subtrees', () => {
    const map = mapOf(
      '<p>visible</p><script>var x = 1;</script><style>p{}</style><noscript>no</noscript>' +
        '<div hidden>hidden</div><textarea>typed</textarea><p>end</p>',
    );
    expect(map.text).toBe('visible end');
  });

  it('drops invisible characters', () => {
    expect(mapOf('<p>hy­phen​ated</p>').text).toBe('hyphenated');
    expect(mapOf('<p>a  b</p>').text).toBe('a b');
  });
});

describe('TextMap offsets', () => {
  const html =
    '<article><h1>  Title  </h1><p>First   paragraph with <em>emphasis</em> and soft­hyphen.</p>' +
    '<p>Second<br>line   here.</p><ul><li>one</li><li> two </li></ul></article>';

  it('round-trips every normalized offset through the DOM', () => {
    const map = mapOf(html);
    for (let offset = 0; offset < map.text.length; offset++) {
      const point = map.offsetToPoint(offset, 'start');
      expect(point).not.toBeNull();
      const back = map.pointToOffset(point!.node, point!.offset);
      if (map.text[offset] === ' ' && back !== offset) {
        // A virtual block separator maps to the start of the next text.
        expect(back).toBe(offset + 1);
      } else {
        expect(back).toBe(offset);
      }
    }
  });

  it('builds ranges covering exactly the requested text', () => {
    const map = mapOf(html);
    for (const phrase of ['paragraph with emphasis', 'softhyphen', 'Second line', 'one two', 'Title']) {
      const start = map.text.indexOf(phrase);
      const range = map.rangeFor(start, start + phrase.length)!;
      expect(compact(range.toString().replace(/­/g, ''))).toBe(compact(phrase));
    }
  });

  it('converts element-boundary selections and trims whitespace', () => {
    const map = mapOf(html);
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('ul')!);
    const offsets = map.rangeToOffsets(range)!;
    expect(map.text.slice(offsets.start, offsets.end)).toBe('one two');

    const title = document.createRange();
    title.selectNodeContents(document.querySelector('h1')!);
    const titleOffsets = map.rangeToOffsets(title)!;
    expect(map.text.slice(titleOffsets.start, titleOffsets.end)).toBe('Title');
  });

  it('returns null for whitespace-only selections', () => {
    const map = mapOf('<p>a</p>   <p>b</p>');
    const range = document.createRange();
    const gap = document.body.childNodes[1];
    range.setStart(gap, 0);
    range.setEnd(gap, 3);
    expect(map.rangeToOffsets(range)).toBeNull();
  });
});
