import {
  DividerBlock,
  HeaderBlock,
  ImageBlock,
  KnownBlock,
  RawTextElement,
  RichTextBlock,
  RichTextLink,
  RichTextText,
  SectionBlock,
  TableBlock,
} from '@slack/types';
import {ListOptions, ParsingOptions} from '../types';
import {section, divider, header, image, table} from '../slack';
import {marked} from 'marked';
import {XMLParser} from 'fast-xml-parser';

type PhrasingToken =
  | marked.Tokens.Link
  | marked.Tokens.Em
  | marked.Tokens.Strong
  | marked.Tokens.Del
  | marked.Tokens.Br
  | marked.Tokens.Image
  | marked.Tokens.Codespan
  | marked.Tokens.Text
  | marked.Tokens.HTML;

function parsePlainText(element: PhrasingToken): string[] {
  switch (element.type) {
    case 'link':
    case 'em':
    case 'strong':
    case 'del':
      return element.tokens.flatMap(child =>
        parsePlainText(child as PhrasingToken)
      );

    case 'br':
      return [];

    case 'image':
      return [element.title ?? element.href];

    case 'codespan':
    case 'text':
    case 'html':
      return [element.raw];
  }
}

function isSectionBlock(block: KnownBlock): block is SectionBlock {
  return block.type === 'section';
}

function parseMrkdwn(
  element: Exclude<PhrasingToken, marked.Tokens.Image>
): string {
  switch (element.type) {
    case 'link': {
      return `<${element.href}|${element.tokens
        .flatMap(child => parseMrkdwn(child as typeof element))
        .join('')}> `;
    }

    case 'em': {
      return `_${element.tokens
        .flatMap(child => parseMrkdwn(child as typeof element))
        .join('')}_`;
    }

    case 'codespan':
      return `\`${element.text}\``;

    case 'strong': {
      return `*${element.tokens
        .flatMap(child => parseMrkdwn(child as typeof element))
        .join('')}*`;
    }

    case 'text':
      return element.text;

    case 'del': {
      return `~${element.tokens
        .flatMap(child => parseMrkdwn(child as typeof element))
        .join('')}~`;
    }

    default:
      return '';
  }
}

function addMrkdwn(
  content: string,
  accumulator: (SectionBlock | ImageBlock)[]
) {
  const last = accumulator[accumulator.length - 1];

  if (last && isSectionBlock(last) && last.text) {
    last.text.text += content;
  } else {
    accumulator.push(section(content));
  }
}

function parsePhrasingContent(
  element: PhrasingToken,
  accumulator: (SectionBlock | ImageBlock)[]
) {
  if (element.type === 'image') {
    const imageBlock: ImageBlock = image(
      element.href,
      element.text || element.title || element.href,
      element.title
    );
    accumulator.push(imageBlock);
  } else {
    const text = parseMrkdwn(element);
    addMrkdwn(text, accumulator);
  }
}

function parseParagraph(element: marked.Tokens.Paragraph): KnownBlock[] {
  return element.tokens.reduce((accumulator, child) => {
    parsePhrasingContent(child as PhrasingToken, accumulator);
    return accumulator;
  }, [] as (SectionBlock | ImageBlock)[]);
}

function parseHeading(element: marked.Tokens.Heading): HeaderBlock {
  return header(
    element.tokens
      .flatMap(child => parsePlainText(child as PhrasingToken))
      .join('')
  );
}

function parseCode(element: marked.Tokens.Code): SectionBlock {
  return section(`\`\`\`\n${element.text}\n\`\`\``);
}

function parseList(
  element: marked.Tokens.List,
  options: ListOptions = {}
): SectionBlock {
  let index = 0;
  const contents = element.items.map(item => {
    const paragraph = item.tokens[0] as marked.Tokens.Text;
    if (!paragraph || paragraph.type !== 'text' || !paragraph.tokens?.length) {
      return paragraph?.text || '';
    }

    const text = paragraph.tokens
      .filter(
        (child): child is Exclude<PhrasingToken, marked.Tokens.Image> =>
          child.type !== 'image'
      )
      .flatMap(parseMrkdwn)
      .join('');

    if (element.ordered) {
      index += 1;
      return `${index}. ${text}`;
    } else if (item.checked !== null && item.checked !== undefined) {
      return `${options.checkboxPrefix?.(item.checked) ?? '• '}${text}`;
    } else {
      return `• ${text}`;
    }
  });

  return section(contents.join('\n'));
}

function parseTableCellToRichText(
  cell: marked.Tokens.TableCell
): RichTextBlock | RawTextElement {
  const elements: (RichTextText | RichTextLink)[] = [];

  for (const token of cell.tokens) {
    const t = token as PhrasingToken;

    switch (t.type) {
      case 'text':
        elements.push({type: 'text', text: t.text});
        break;

      case 'strong': {
        const text = t.tokens
          .flatMap(c => parsePlainText(c as PhrasingToken))
          .join('');
        elements.push({type: 'text', text, style: {bold: true}});
        break;
      }

      case 'em': {
        const text = t.tokens
          .flatMap(c => parsePlainText(c as PhrasingToken))
          .join('');
        elements.push({type: 'text', text, style: {italic: true}});
        break;
      }

      case 'del': {
        const text = t.tokens
          .flatMap(c => parsePlainText(c as PhrasingToken))
          .join('');
        elements.push({type: 'text', text, style: {strike: true}});
        break;
      }

      case 'codespan':
        elements.push({type: 'text', text: t.text, style: {code: true}});
        break;

      case 'link': {
        const text = t.tokens
          .flatMap(c => parsePlainText(c as PhrasingToken))
          .join('');
        elements.push({type: 'link', text: text || t.href, url: t.href});
        break;
      }

      case 'image':
        elements.push({type: 'text', text: t.title || t.href});
        break;

      case 'br':
      case 'html':
        break;
    }
  }

  if (elements.length === 0) {
    return {type: 'raw_text', text: ''};
  }

  if (
    elements.length === 1 &&
    elements[0].type === 'text' &&
    !elements[0].style
  ) {
    return {type: 'raw_text', text: elements[0].text};
  }

  return {
    type: 'rich_text',
    elements: [{type: 'rich_text_section', elements}],
  };
}

function parseTable(element: marked.Tokens.Table): TableBlock {
  const allRows: marked.Tokens.TableCell[][] = [
    element.header,
    ...element.rows,
  ];

  const parsedRows: (RichTextBlock | RawTextElement)[][] = allRows.map(row =>
    row.map(cell => parseTableCellToRichText(cell))
  );

  return table(parsedRows);
}

function parseBlockquote(element: marked.Tokens.Blockquote): KnownBlock[] {
  return element.tokens
    .filter(
      (child): child is marked.Tokens.Paragraph => child.type === 'paragraph'
    )
    .flatMap(p =>
      parseParagraph(p).map(block => {
        if (isSectionBlock(block) && block.text?.text?.includes('\n'))
          block.text.text = '> ' + block.text.text.replace(/\n/g, '\n> ');
        return block;
      })
    );
}

function parseThematicBreak(): DividerBlock {
  return divider();
}

function parseHTML(
  element: marked.Tokens.HTML | marked.Tokens.Tag
): KnownBlock[] {
  const parser = new XMLParser({ignoreAttributes: false});
  const res = parser.parse(element.raw);

  if (res.img) {
    const tags = res.img instanceof Array ? res.img : [res.img];

    return tags
      .map((img: Record<string, string>) => {
        const url: string = img['@_src'];
        return image(url, img['@_alt'] || url);
      })
      .filter((e: Record<string, string>) => !!e);
  } else return [];
}

function parseToken(
  token: marked.Token,
  options: ParsingOptions
): KnownBlock[] {
  switch (token.type) {
    case 'heading':
      return [parseHeading(token)];

    case 'paragraph':
      return parseParagraph(token);

    case 'code':
      return [parseCode(token)];

    case 'blockquote':
      return parseBlockquote(token);

    case 'list':
      return [parseList(token, options.lists)];

    case 'table':
      return [parseTable(token)];

    case 'hr':
      return [parseThematicBreak()];

    case 'html':
      return parseHTML(token);

    default:
      return [];
  }
}

export function parseBlocks(
  tokens: marked.TokensList,
  options: ParsingOptions = {}
): KnownBlock[] {
  return tokens.flatMap(token => parseToken(token, options));
}
