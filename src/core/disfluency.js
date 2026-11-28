(() => {
  'use strict';

  const loadDep = (key, path) => {
    if (globalThis.YTSC?.[key]) return globalThis.YTSC[key];
    if (typeof require !== 'undefined') return require(path)[key];
    throw new Error(`YTSC dependency missing: ${key}`);
  };

  // Hesitation sounds. "à" (vi) is left out: it is also a real sentence particle.
  const FILLERS = new Set([
    'um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'hmm', 'hm', 'mm', // en
    'äh', 'ähm', 'öh', 'ehm', // de
    'ờ', 'ừm', 'ừ', 'ơ', 'ờm', // vi
  ]);
  // Sound tags YouTube's ASR inserts for music ("[Music]", "[Musik]", "[âm nhạc]").
  const MUSIC_TAGS = new Set(['music', 'musik', 'música', 'musique', 'musica', 'muziek', 'âm nhạc', 'nhạc']);
  const MUSIC_NOTE = '♪';

  // Discourse markers that are often, but not always, filler (opt-in).
  const AGGRESSIVE_PHRASES = [['you', 'know'], ['i', 'mean'], ['weißt', 'du'], ['kiểu', 'như']];
  // Coordinators do not keep a comma that only set off a dropped filler
  // ("Und, äh, am" → "Und am"). Clause commas ("glaube, dass") stay.
  const BARE_CONJ = new Set([
    'and', 'but', 'or', 'nor', 'yet', 'so',
    'und', 'oder', 'aber', 'sondern', 'doch',
    'và', 'hoặc', 'nhưng',
  ]);

  // Longest "[…]" sound tag strict cleaning looks for ("[indistinct chatter in the background]").
  const MAX_TAG_WORDS = 6;
  const PAUSE_MS = 600;
  const MAX_REPEAT_WORDS = 4;
  // Prefer a missed stumble to deleting an object/subject pair ("tell you you")
  // or emphasis ("no no", "very very"). Only clear unfinished starts qualify.
  const RESTART_WORDS = new Set([
    'i', "i'm", "i've", "i'll", "i'd", "it's", 'the', 'a', 'an',
    'and', 'but', 'or', 'of', 'to', 'with', 'from', 'for', 'in', 'on', 'at', 'by', 'if', 'because',
    'ich', 'und', 'aber', 'oder', 'mit', 'và', 'nhưng',
  ]);
  const SUBJECTS = new Set(['i', 'you', 'we', 'they', 'he', 'she', 'it', "i'm", "it's"]);
  const PREFIX_ENDS = new Set(['am', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'a', 'an', 'the', 'to', 'like', 'goes', 'says']);
  const OPEN_CLOSE = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»', '(': ')', '（': '）', '「': '」', '『': '』' };
  const CLOSING_MARKS = /["'»”’)}\]）」』]+$/u;

  /**
   * "Clean verbatim" captions: drops fillers (um, uh, äh, ờ…) and stumbles
   * ("I I I think", "It's, um, it's"), the way subtitle guidelines ask, and
   * turns "[Music]" tags into a standalone ♪. Strict cleaning drops every sound
   * tag instead ("[Applause]", "[Laughter]", "[Music]"…), leaving only speech.
   * Works on timed words { text, startMs, endMs }. Pure, no DOM.
   * Single responsibility: disfluency detection and removal.
   */
  class Disfluency {
    /**
     * @param aggressive also treat "like", "you know", "I mean" (…) as fillers
     * @param drop       kinds that clean() removes (default: both)
     */
    constructor({ aggressive = false, drop = ['filler', 'repeat'], textUtils = null } = {}) {
      this.aggressive = aggressive;
      this.drop = new Set(drop);
      this.text = textUtils || loadDep('TextUtils', './text-utils.js');
    }

    /** Index-aligned kinds: 'filler' | 'repeat' | undefined. */
    detect(words) {
      const key = (i) => this.text.comparableWord(words[i]?.text);
      // Manual captions are already edited. A repeated phrase there is a lyric
      // ("về nhà về nhà"), not a stumble, and a filler-shaped word was typed on purpose.
      const kinds = words.map((word, i) =>
        word?.estimated || !FILLERS.has(key(i)) ? undefined : 'filler'
      );

      // Sentence ends, actual pauses, speaker changes and manual cues are hard
      // boundaries. In particular, "do I do? I" is not an ABAB stumble.
      const runs = [];
      let run = [];
      const close = () => { if (run.length) runs.push(run); run = []; };
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const prev = words[i - 1];
        if (word.speakerStart || word.cueStart || (prev &&
          (this.text.sentenceIsComplete(prev.text) || word.startMs - prev.endMs >= PAUSE_MS))) close();
        const tagEnd = this._bracketEnd(words, i, MAX_TAG_WORDS);
        if (tagEnd >= i) {
          close();
          for (; i <= tagEnd; i++) kinds[i] = undefined;
          i--;
        } else if (word.estimated || word.standalone || !key(i)) close();
        else run.push(i);
      }
      close();

      for (const indices of runs) {
        if (this.aggressive) {
          for (let n = 0; n < indices.length; n++) {
            const i = indices[n];
            for (const phrase of AGGRESSIVE_PHRASES) {
              if (phrase.every((p, j) => key(indices[n + j]) === p)) {
                phrase.forEach((_, j) => { kinds[indices[n + j]] = 'filler'; });
              }
            }
            // "like" as a filler only when set off by commas ("And, like, when …").
            const commaBefore = n > 0 && /,$/.test(words[indices[n - 1]].text);
            if (key(i) === 'like' && (/,$/.test(words[i].text) || commaBefore)) kinds[i] = 'filler';
          }
        }
        // Look through hesitation fillers, retaining the last unfinished start.
        const content = indices.filter(i => !kinds[i]);
        for (let n = 0; n < content.length; n++) {
          for (let size = Math.min(MAX_REPEAT_WORDS, Math.floor((content.length - n) / 2)); size >= 1; size--) {
            const first = content.slice(n, n + size);
            const keys = first.map(key);
            if (!this._restartPrefix(keys) || !keys.every((k, j) => k === key(content[n + size + j]))) continue;
            if (size > 1) {
              // "I am, I am." is a complete emphatic reply. A restart needs
              // continuing speech after the whole chain of repeated prefixes.
              let after = n + size * 2;
              while (keys.every((k, j) => k === key(content[after + j]))) after += size;
              if (after >= content.length) continue;
            }
            first.forEach(i => { kinds[i] = 'repeat'; });
            break;
          }
        }
      }
      return kinds;
    }

    _restartPrefix(keys) {
      if (keys.length === 1) return RESTART_WORDS.has(keys[0]);
      if (keys.length === 2 && BARE_CONJ.has(keys[0]) && keys[1] === 'then') return true;
      const clause = BARE_CONJ.has(keys[0]) ? keys.slice(1) : keys;
      return clause.length >= 2 && SUBJECTS.has(clause[0]) && PREFIX_ENDS.has(clause.at(-1));
    }

    /**
     * "[Music]" (possibly spanning words, like "[âm nhạc]") -> one standalone ♪
     * covering the tag's time; consecutive tags merge into a single note.
     */
    replaceMusicTags(words) {
      const out = [];
      for (let i = 0; i < words.length; i++) {
        const end = this._bracketEnd(words, i);
        const inner = end < 0 ? null : words.slice(i, end + 1).map((w) => w.text).join(' ');
        const tag = inner?.replace(/^\[|\]\p{P}*$/gu, '').trim().toLocaleLowerCase();
        if (!tag || !MUSIC_TAGS.has(tag)) {
          out.push(words[i]);
          continue;
        }
        const prev = out[out.length - 1];
        if (prev?.text === MUSIC_NOTE && !words[i].speakerStart && !words[i].cueStart &&
          words[i].startMs - prev.endMs < PAUSE_MS) {
          out[out.length - 1] = { ...prev, endMs: Math.max(prev.endMs, words[end].endMs) };
        } else {
          const note = { ...words[i], text: MUSIC_NOTE, endMs: words[end].endMs, standalone: true };
          delete note.lineBreak; // a standalone note has no preceding line to wrap
          out.push(note);
        }
        i = end;
      }
      return out;
    }

    /**
     * Without "[Applause]", "[Laughter]", "[Music]" and other sound tags. A tag's
     * sentence stop stays on the word before it; its time is not absorbed (the pause
     * is real). A tag that opened a caption cue hands that cue start to the cue's next
     * word. "[ __ ]" is YouTube's bleeped swear word, not a sound: it stays.
     */
    dropSoundTags(words) {
      return this._dropSoundTags(words).words;
    }

    /** dropSoundTags, plus the words that directly follow a dropped tag. */
    _dropSoundTags(words) {
      const out = [];
      const afterTag = new WeakSet();
      let follows = false; // the next kept word comes right after a dropped tag
      let carryCueStart = false;
      let carrySpeakerStart = false;
      for (let i = 0; i < words.length; i++) {
        const end = this._bracketEnd(words, i, MAX_TAG_WORDS);
        const inner = end < 0 ? '' : words.slice(i, end + 1).map((w) => w.text).join(' ');
        if (!/\p{L}/u.test(inner)) {
          let word = words[i];
          if (carryCueStart && !word.cueStart) word = { ...word, cueStart: true };
          if (carrySpeakerStart && !word.speakerStart) word = { ...word, speakerStart: true };
          if (follows) afterTag.add(word);
          out.push(word);
          follows = false;
          carryCueStart = false;
          carrySpeakerStart = false;
          continue;
        }
        const terminal = words[end].text.match(/\]\p{P}*?([.!?…。！？؟]+)\p{P}*$/u)?.[1];
        const prev = out[out.length - 1];
        if (terminal && prev && !prev.standalone && !words[i].speakerStart && !carrySpeakerStart) {
          const text = this._repairTerminal(prev.text, terminal);
          if (text !== prev.text) out[out.length - 1] = { ...prev, text };
        }
        if (words[i].cueStart) carryCueStart = true;
        if (words[i].speakerStart) carrySpeakerStart = true;
        follows = true;
        i = end;
      }
      return { words: out, afterTag };
    }

    /**
     * Index of the word closing a "[…]" tag that starts at i (max `span` words), or -1.
     * The first "]" decides: it closes the tag when only punctuation follows it ("]。").
     */
    _bracketEnd(words, i, span = 3) {
      return this.text.soundTagEnd(words, i, span);
    }

    /** Only unmatched opening/closing marks survive removal of a quoted filler. */
    _droppedPunctuation(text) {
      let opening = text.match(/^["'“‘«(（「『]+/u)?.[0] || '';
      const suffix = text.match(/[^\p{L}\p{N}]+$/u)?.[0] || '';
      const terminal = suffix.match(/[.!?…。！？؟]+/u)?.[0] || '';
      let closing = [...suffix].filter(c => CLOSING_MARKS.test(c)).join('');
      // "um", (uh), and nested pairs disappear together. A leading quote in
      // '"Uh hello"' still moves to hello; its closing quote is on a kept word.
      while (opening && closing && OPEN_CLOSE[opening.at(-1)] === closing[0]) {
        opening = opening.slice(0, -1);
        closing = closing.slice(1);
      }
      return { opening, terminal, closing };
    }

    /** Add a missing stop before existing closers, without duplicating either. */
    _repairTerminal(text, terminal, closing = '') {
      const existing = text.match(CLOSING_MARKS)?.[0] || '';
      let body = existing ? text.slice(0, -existing.length) : text;
      if (terminal && !/[.!?…。！？؟;:；：؛]$/u.test(body)) {
        body = body.replace(/[,，、،]$/u, '') + terminal;
      }
      let overlap = Math.min(existing.length, closing.length);
      while (overlap && !existing.endsWith(closing.slice(0, overlap))) overlap--;
      return body + existing + closing.slice(overlap);
    }

    /**
     * Returns a new word list without fillers and repeats, kept well-formed:
     * a dropped word's terminal punctuation moves to the previous word, a
     * dropped sentence-initial capital passes to the next word, and the
     * previous word absorbs the dropped time (so no fake pause splits chunks).
     * Unchanged words are shared with the input; repaired words are cloned on
     * demand so a typical clean track does not duplicate every word object.
     * strict: also drop every sound tag, "[Music]" included (see dropSoundTags).
     */
    clean(words, { strict = false } = {}) {
      words = this.text.withSpeakerBoundaries(words);
      let afterTag = null;
      if (strict) ({ words, afterTag } = this._dropSoundTags(words));
      else words = this.replaceMusicTags(words);
      const kinds = this.detect(words);
      const out = [];
      const owned = new WeakSet(); // clones made here; safe to repair again later
      let capitalizeNext = false;
      let opening = '';
      let speakerStart = false;
      let cueStart = false;
      let previousOriginalEndMs = null;
      // Right after a dropped sound tag the pause is real: words dropped there
      // ("[Applause] um anyway") give the word before the tag none of their time.
      let pauseBefore = false;
      words.forEach((word, i) => {
        if (word.speakerStart) {
          // A removed filler-only turn must not donate punctuation to another speaker.
          opening = '';
          capitalizeNext = false;
          speakerStart = true;
        }
        if (word.cueStart) cueStart = true;
        if (afterTag?.has(word) || word.speakerStart || word.cueStart ||
          (i && word.startMs - words[i - 1].endMs >= PAUSE_MS)) pauseBefore = true;
        if (!this.drop.has(kinds[i])) {
          pauseBefore = false;
          let { text } = word;
          // A ♪ cue is not a word: the capital waits for the word after it.
          if (capitalizeNext && !word.standalone) {
            text = text.replace(/\p{L}/u, letter => letter.toLocaleUpperCase());
            capitalizeNext = false;
          }
          if (opening && !word.standalone) {
            text = opening + text;
            opening = '';
          }
          const boundary = (speakerStart && !word.speakerStart) || (cueStart && !word.cueStart);
          if (text === word.text && !boundary) out.push(word);
          else {
            const clone = { ...word, text };
            if (speakerStart) clone.speakerStart = true;
            if (cueStart) clone.cueStart = true;
            owned.add(clone);
            out.push(clone);
          }
          speakerStart = false;
          cueStart = false;
          previousOriginalEndMs = word.endMs;
          return;
        }
        let prev = out[out.length - 1];
        const { opening: lead, terminal, closing } = this._droppedPunctuation(word.text);
        opening += lead;
        const startsSentence = !prev || speakerStart || cueStart || this.text.sentenceIsComplete(prev.text);
        if ((startsSentence || lead) && /^["'“‘«(（「『]*\p{Lu}/u.test(word.text)) capitalizeNext = true;
        // A new sentence, speaker, cue or real pause never extends the previous word.
        if (startsSentence) pauseBefore = true;
        // Long hesitations are real pauses, even without ASR punctuation.
        const longHesitation = prev && word.endMs - previousOriginalEndMs >= 1000;
        if (longHesitation) pauseBefore = true;
        if (!prev || prev.standalone || speakerStart || cueStart) return;
        if (!owned.has(prev)) {
          prev = { ...prev };
          owned.add(prev);
          out[out.length - 1] = prev;
        }
        if (terminal || closing) {
          prev.text = this._repairTerminal(prev.text, terminal, closing);
        } else if (kinds[i] === 'filler' && BARE_CONJ.has(this.text.comparableWord(prev.text))) {
          prev.text = prev.text.replace(/,(["'»”’)]*)$/u, '$1');
        }
        // Once a chain becomes a real pause, undo earlier partial absorption
        // too, so several short fillers cannot hide a long hesitation.
        if (longHesitation) prev.endMs = previousOriginalEndMs;
        else if (!pauseBefore) prev.endMs = Math.max(prev.endMs, word.endMs);
      });
      return out;
    }
  }

  Disfluency.MUSIC_NOTE = MUSIC_NOTE;

  const api = { Disfluency };
  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
