import type {
  DividerBlock,
  HeaderBlock,
  ImageBlock,
  RawTextElement,
  RichTextBlock,
  SectionBlock,
  TableBlock,
} from '@slack/types';

const MAX_TEXT_LENGTH = 3000;
const MAX_TABLE_ROWS = 100;
const MAX_TABLE_COLUMNS = 20;
const MAX_HEADER_LENGTH = 150;
const MAX_IMAGE_TITLE_LENGTH = 2000;
const MAX_IMAGE_ALT_TEXT_LENGTH = 2000;

export function section(text: string): SectionBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: text.slice(0, MAX_TEXT_LENGTH),
    },
  };
}

export function divider(): DividerBlock {
  return {
    type: 'divider',
  };
}

export function header(text: string): HeaderBlock {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text: text.slice(0, MAX_HEADER_LENGTH),
    },
  };
}

export function image(
  url: string,
  altText: string,
  title?: string
): ImageBlock {
  return {
    type: 'image',
    image_url: url,
    alt_text: altText.slice(0, MAX_IMAGE_ALT_TEXT_LENGTH),
    title: title
      ? {
          type: 'plain_text',
          text: title.slice(0, MAX_IMAGE_TITLE_LENGTH),
        }
      : undefined,
  };
}

export function table(rows: (RichTextBlock | RawTextElement)[][]): TableBlock {
  const truncatedRows = rows
    .slice(0, MAX_TABLE_ROWS)
    .map(row => row.slice(0, MAX_TABLE_COLUMNS));

  return {
    type: 'table',
    rows: truncatedRows,
  };
}
