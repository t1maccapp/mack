import * as slack from '../src/slack';
import {parseBlocks} from '../src/parser/internal';
import {marked} from 'marked';

describe('parser', () => {
  it('should parse basic markdown', () => {
    const tokens = marked.lexer('**a ~b~** c[*d*](https://example.com)');
    const actual = parseBlocks(tokens);

    const expected = [slack.section('*a ~b~* c<https://example.com|_d_> ')];

    expect(actual).toStrictEqual(expected);
  });

  it('should parse header', () => {
    const tokens = marked.lexer('# a');
    const actual = parseBlocks(tokens);

    const expected = [slack.header('a')];

    expect(actual).toStrictEqual(expected);
  });

  it('should parse thematic break', () => {
    const tokens = marked.lexer('---');
    const actual = parseBlocks(tokens);

    const expected = [slack.divider()];

    expect(actual).toStrictEqual(expected);
  });

  it('should parse lists', () => {
    const tokens = marked.lexer(
      `
    1. a
    2. b
    - c
    - d
    * e
    * f
    `
        .trim()
        .split('\n')
        .map(s => s.trim())
        .join('\n')
    );
    const actual = parseBlocks(tokens);

    const expected = [
      slack.section('1. a\n2. b'),
      slack.section('• c\n• d'),
      slack.section('• e\n• f'),
    ];

    expect(actual).toStrictEqual(expected);
  });

  it('should parse images', () => {
    const tokens = marked.lexer('![alt](url "title")![](url)');
    const actual = parseBlocks(tokens);

    const expected = [
      slack.image('url', 'alt', 'title'),
      slack.image('url', 'url'),
    ];

    expect(actual).toStrictEqual(expected);
  });
});

describe('table parsing', () => {
  it('should parse simple table with plain text', () => {
    const tokens = marked.lexer(
      '| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n| Cell 3 | Cell 4 |'
    );
    const actual = parseBlocks(tokens);

    expect(actual).toHaveLength(1);
    expect(actual[0].type).toBe('table');
    const tableBlock = actual[0] as any;
    expect(tableBlock.rows).toHaveLength(3);
    expect(tableBlock.rows[0][0]).toEqual({type: 'raw_text', text: 'Header 1'});
    expect(tableBlock.rows[0][1]).toEqual({type: 'raw_text', text: 'Header 2'});
    expect(tableBlock.rows[1][0]).toEqual({type: 'raw_text', text: 'Cell 1'});
    expect(tableBlock.rows[2][1]).toEqual({type: 'raw_text', text: 'Cell 4'});
  });

  it('should parse table with bold formatting', () => {
    const tokens = marked.lexer(
      '| **Bold** | Normal |\n| --- | --- |\n| Cell | Cell |'
    );
    const actual = parseBlocks(tokens);

    const tableBlock = actual[0] as any;
    expect(tableBlock.rows[0][0].type).toBe('rich_text');
    expect(tableBlock.rows[0][0].elements[0].elements[0]).toMatchObject({
      type: 'text',
      text: 'Bold',
      style: {bold: true},
    });
    expect(tableBlock.rows[0][1]).toEqual({type: 'raw_text', text: 'Normal'});
  });

  it('should parse table with italic formatting', () => {
    const tokens = marked.lexer('| _Italic_ | Normal |\n| --- | --- |');
    const actual = parseBlocks(tokens);

    const tableBlock = actual[0] as any;
    expect(tableBlock.rows[0][0].type).toBe('rich_text');
    expect(tableBlock.rows[0][0].elements[0].elements[0]).toMatchObject({
      type: 'text',
      text: 'Italic',
      style: {italic: true},
    });
  });

  it('should parse table with strikethrough', () => {
    const tokens = marked.lexer('| ~~Strike~~ | Normal |\n| --- | --- |');
    const actual = parseBlocks(tokens);

    const tableBlock = actual[0] as any;
    expect(tableBlock.rows[0][0].type).toBe('rich_text');
    expect(tableBlock.rows[0][0].elements[0].elements[0]).toMatchObject({
      type: 'text',
      text: 'Strike',
      style: {strike: true},
    });
  });

  it('should parse table with inline code', () => {
    const tokens = marked.lexer('| `code` | Normal |\n| --- | --- |');
    const actual = parseBlocks(tokens);

    const tableBlock = actual[0] as any;
    expect(tableBlock.rows[0][0].type).toBe('rich_text');
    expect(tableBlock.rows[0][0].elements[0].elements[0]).toMatchObject({
      type: 'text',
      text: 'code',
      style: {code: true},
    });
  });

  it('should parse table with links', () => {
    const tokens = marked.lexer(
      '| [Link](https://example.com) | Normal |\n| --- | --- |'
    );
    const actual = parseBlocks(tokens);

    const tableBlock = actual[0] as any;
    expect(tableBlock.rows[0][0].type).toBe('rich_text');
    expect(tableBlock.rows[0][0].elements[0].elements[0]).toMatchObject({
      type: 'link',
      text: 'Link',
      url: 'https://example.com',
    });
  });

  it('should parse table with mixed formatting in single cell', () => {
    const tokens = marked.lexer(
      '| Header |\n| --- |\n| **bold** and _italic_ |'
    );
    const actual = parseBlocks(tokens);

    const tableBlock = actual[0] as any;
    const richCell = tableBlock.rows[1][0];
    expect(richCell.type).toBe('rich_text');
    expect(richCell.elements[0].elements.length).toBeGreaterThan(1);
  });

  it('should truncate tables exceeding 100 rows', () => {
    const dataRows = Array(105).fill('| Cell |').join('\n');
    const markdown = `| Header |\n| --- |\n${dataRows}`;
    const tokens = marked.lexer(markdown);
    const actual = parseBlocks(tokens);

    const tableBlock = actual[0] as any;
    expect(tableBlock.rows.length).toBeLessThanOrEqual(100);
  });

  it('should truncate tables exceeding 20 columns', () => {
    const cols = Array(25).fill('H').join(' | ');
    const sep = Array(25).fill('---').join(' | ');
    const row = Array(25).fill('C').join(' | ');
    const markdown = `| ${cols} |\n| ${sep} |\n| ${row} |`;
    const tokens = marked.lexer(markdown);
    const actual = parseBlocks(tokens);

    const tableBlock = actual[0] as any;
    expect(tableBlock.rows[0].length).toBeLessThanOrEqual(20);
  });

  it('should handle empty cells', () => {
    const tokens = marked.lexer('| A | |\n| --- | --- |\n| | B |');
    const actual = parseBlocks(tokens);

    const tableBlock = actual[0] as any;
    expect(tableBlock.rows[0][1]).toEqual({type: 'raw_text', text: ''});
    expect(tableBlock.rows[1][0]).toEqual({type: 'raw_text', text: ''});
  });
});

describe('mrkdwn spacing for Slack compatibility', () => {
  it('should add space before bold when preceded by closing paren', () => {
    const tokens = marked.lexer('(-26°C)**Conditions:** Light');
    const actual = parseBlocks(tokens);
    const expected = [slack.section('(-26°C) *Conditions:* Light')];
    expect(actual).toStrictEqual(expected);
  });

  it('should not add space before bold when already spaced', () => {
    const tokens = marked.lexer('(-26°C) **Conditions:** Light');
    const actual = parseBlocks(tokens);
    const expected = [slack.section('(-26°C) *Conditions:* Light')];
    expect(actual).toStrictEqual(expected);
  });

  it('should add space before bold when preceded by alphanumeric', () => {
    const tokens = marked.lexer('hello**world**there');
    const actual = parseBlocks(tokens);
    const expected = [slack.section('hello *world* there')];
    expect(actual).toStrictEqual(expected);
  });

  it('should not add space before bold at start of text', () => {
    const tokens = marked.lexer('**bold** text');
    const actual = parseBlocks(tokens);
    const expected = [slack.section('*bold* text')];
    expect(actual).toStrictEqual(expected);
  });

  it('should not break nested formatting', () => {
    const tokens = marked.lexer('**_italic inside bold_ end**');
    const actual = parseBlocks(tokens);
    const expected = [slack.section('*_italic inside bold_ end*')];
    expect(actual).toStrictEqual(expected);
  });

  it('should add space before italic when preceded by non-whitespace', () => {
    const tokens = marked.lexer('word*italic*rest');
    const actual = parseBlocks(tokens);
    const expected = [slack.section('word _italic_ rest')];
    expect(actual).toStrictEqual(expected);
  });

  it('should add space before strikethrough when preceded by non-whitespace', () => {
    const tokens = marked.lexer('word~~strike~~rest');
    const actual = parseBlocks(tokens);
    const expected = [slack.section('word ~strike~ rest')];
    expect(actual).toStrictEqual(expected);
  });

  it('should fix spacing in list items', () => {
    const tokens = marked.lexer('- text**bold**more');
    const actual = parseBlocks(tokens);
    const expected = [slack.section('• text *bold* more')];
    expect(actual).toStrictEqual(expected);
  });
});

it('should truncate basic markdown', () => {
  const a4000 = new Array(4000).fill('a').join('');
  const a3000 = new Array(3000).fill('a').join('');

  const tokens = marked.lexer(a4000);
  const actual = parseBlocks(tokens);

  const expected = [slack.section(a3000)];

  expect(actual.length).toStrictEqual(expected.length);
});

it('should truncate header', () => {
  const a200 = new Array(200).fill('a').join('');
  const a150 = new Array(150).fill('a').join('');

  const tokens = marked.lexer(`# ${a200}`);
  const actual = parseBlocks(tokens);

  const expected = [slack.header(a150)];

  expect(actual.length).toStrictEqual(expected.length);
});

it('should truncate image title', () => {
  const a3000 = new Array(3000).fill('a').join('');
  const a2000 = new Array(2000).fill('a').join('');

  const tokens = marked.lexer(`![${a3000}](url)`);
  const actual = parseBlocks(tokens);

  const expected = [slack.image('url', a2000)];

  expect(actual.length).toStrictEqual(expected.length);
});
