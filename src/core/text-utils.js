(() => {
  'use strict';

  // Punctuation that hangs off the word before it ("hello ," -> "hello,") or
  // leads into the word after it ("¿ qué" -> "¿qué"). Bare straight quotes are
  // ambiguous (opening or closing), so they stay put.
  const CLOSING = /^[.,;:!?…%)\]}»”’"'、。，！？；：）」』،؛؟]+$/u;
  // Marks a speaker pauses after, in the scripts caption tracks use (Latin,
  // full-width CJK, Arabic), allowing closing quotes or brackets after them.
  const SENTENCE_PAUSE = /[.!?…。！？؟]["'»”’)}\]）」』]*$/u;
  const CLAUSE_PAUSE = /[,;:、，；：،؛]["'»”’)}\]）」』]*$/u;
  const OPENING = /^[(\[{«“‘¿¡（「『]+$/u;
  const QUOTES = /^["']+$/u;

  /**
   * Pure helpers for caption text and token boundaries. No DOM.
   */
  class TextUtils {
    static normalize(text) {
      return String(text || '')
        .replace(/[\u200b\ufeff]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    static comparableWord(word) {
      return String(word || '')
        .toLowerCase()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    }

    static splitWords(text) {
      const n = TextUtils.normalize(text);
      return n ? TextUtils.attachPunctuation(n.split(/\s+/)) : [];
    }

    /** Store speaker markers as boundaries; display them beside the next kept word. */
    static withSpeakerBoundaries(words) {
      const out = [];
      let marker = null;
      for (const word of words) {
        if (word.text === '>>') {
          marker = word;
          continue;
        }
        out.push(marker ? {
          ...word, speakerStart: true,
          // A marker split out of the same segment must not steal speech time.
          startMs: marker.endMs === word.startMs ? marker.startMs : word.startMs,
        } : word);
        marker = null;
      }
      return out;
    }

    static captionText(words) {
      return words.map(word => `${word.speakerStart ? '>> ' : ''}${word.text}`).join(' ');
    }

    /** End of a bounded sound tag; malformed brackets remain ordinary text. */
    static soundTagEnd(words, i, span = 6) {
      if (!words[i]?.text.startsWith('[')) return -1;
      for (let j = i; j < Math.min(words.length, i + span); j++) {
        const word = words[j];
        if (j > i && (word.speakerStart || word.cueStart || word.text.startsWith('['))) return -1;
        const close = word.text.indexOf(']');
        if (close >= 0) return /^\]\p{P}*$/u.test(word.text.slice(close)) ? j : -1;
      }
      return -1;
    }

    /** Keep a sound description intact when applying caption size limits. */
    static groupSoundTags(words) {
      const out = [];
      for (let i = 0; i < words.length; i++) {
        const end = TextUtils.soundTagEnd(words, i);
        if (end > i) {
          out.push({ ...words[i], text: words.slice(i, end + 1).map(w => w.text).join(' '), endMs: words[end].endMs });
          i = end;
        } else out.push(words[i]);
      }
      return out;
    }

    /** 'prev' | 'next' for a punctuation-only token, else null. */
    static punctuationSide(token) {
      if (OPENING.test(token)) return 'next';
      if (CLOSING.test(token) && !QUOTES.test(token)) return 'prev';
      return null;
    }

    /**
     * Folds punctuation-only tokens into the neighbouring word, so "hello , world !"
     * reads "hello, world!" and the marks don't count as words.
     * Works on strings, or on any item given textOf/withText accessors.
     */
    static attachPunctuation(items, textOf = (x) => x, withText = (_, text) => text) {
      const out = [];
      let lead = null; // opening marks waiting for the next word
      for (const item of items) {
        const text = textOf(item);
        const side = TextUtils.punctuationSide(text);
        if (side === 'next' || (side === 'prev' && lead)) {
          lead = { item: lead?.item ?? item, text: (lead?.text ?? '') + text };
        } else if (side === 'prev' && out.length) {
          const i = out.length - 1;
          out[i] = withText(out[i], textOf(out[i]) + text);
        } else {
          out.push(lead ? withText(item, lead.text + text) : item);
          lead = null;
        }
      }
      if (lead) out.push(withText(lead.item, lead.text));
      return out;
    }

    /** 'sentence' | 'clause' when a speaker pauses after this word, else null. */
    static pauseAfter(text) {
      if (SENTENCE_PAUSE.test(text)) return 'sentence';
      if (CLAUSE_PAUSE.test(text)) return 'clause';
      return null;
    }

    static sentenceIsComplete(text) {
      return SENTENCE_PAUSE.test(TextUtils.normalize(text));
    }

    static rawEventText(event) {
      const segs = Array.isArray(event?.segs) ? event.segs : [];
      return segs.map((s) => s.utf8 || '').join('');
    }

    static eventText(event) {
      return TextUtils.normalize(TextUtils.rawEventText(event));
    }

    static isRollupBreak(event) {
      return Boolean(event?.aAppend) && /^\s*\n\s*$/u.test(TextUtils.rawEventText(event));
    }
  }

  const api = { TextUtils };
  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
