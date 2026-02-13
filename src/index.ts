import type {KnownBlock} from '@slack/types';
import {decode} from 'he';
import {parseBlocks} from './parser/internal';
import type {ParsingOptions} from './types';
import {marked} from 'marked';

/**
 * Parses Markdown content into Slack BlockKit Blocks.
 * - Supports headings (all Markdown heading levels are treated as the single Slack header block)
 * - Supports numbered lists, bulleted lists, to-do lists
 * - Supports italics, bold, strikethrough, inline code, hyperlinks
 * - Supports images
 * - Supports thematic breaks / dividers
 *
 * Per Slack limitations, these markdown attributes are not completely supported:
 * - Tables: they will be copied but Slack will render them as text
 * - Block quotes (limited functionality; does not support lists, headings, or images within the block quote)
 *
 * Supports GitHub-flavoured Markdown.
 *
 * @param body any Markdown or GFM content
 * @param options options to configure the parser
 */
export async function markdownToBlocks(
  body: string,
  options: ParsingOptions = {}
): Promise<KnownBlock[]> {
  // Slack only wants &, <, and > escaped
  // https://api.slack.com/reference/surfaces/formatting#escaping
  const replacements: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
  };

  const lexer = new marked.Lexer();
  const tokenizer = (lexer as unknown as {tokenizer: marked.Tokenizer})
    .tokenizer;
  const inlineTextRule = (
    tokenizer as unknown as {rules: {inline: {text: RegExp}}}
  ).rules.inline.text;
  const decodeAndEscape = (src: string): string => {
    const decoded = decode(src, {isAttributeValue: false, strict: false});
    return decoded.replace(/[&<>]/g, char => replacements[char]);
  };

  tokenizer.inlineText = (src: string) => {
    const cap = inlineTextRule.exec(src);
    if (!cap) return false as never;

    return {
      type: 'text',
      raw: cap[0],
      text: decodeAndEscape(cap[0]),
    };
  };

  const codespanRule =
    /^(?:\*{1,2})?(`+)([^`]|[^`][\s\S]*?[^`])\1(?!\*)(?:\*{1,2})?/;
  tokenizer.codespan = (src: string) => {
    const cap = codespanRule.exec(src);
    if (!cap) return false as never;

    let text = cap[2].replace(/\n/g, ' ');
    const hasNonSpaceChars = /[^ ]/.test(text);
    const hasSpaceCharsOnBothEnds = /^ /.test(text) && / $/.test(text);
    if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
      text = text.substring(1, text.length - 1);
    }

    return {
      type: 'codespan',
      raw: cap[0],
      text: decodeAndEscape(text),
    };
  };

  const tokens = lexer.lex(body);

  return parseBlocks(tokens, options);
}
