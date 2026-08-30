(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.musicXMLAudioPlugin = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function musicXMLAudioPlugin(runner, options = {}) {
    // Direct Audio AST processing handlers
    runner.define('element', 'score-partwise', {
      parseScore(ctx) {
        const title = this.querySelector('work-title, movement-title')?.textContent?.trim() || 'Untitled Score';
        let tempo = 120;
        const soundEl = this.querySelector('sound[tempo]');
        if (soundEl) tempo = parseFloat(soundEl.getAttribute('tempo'));

        const parts = [];
        for (const child of Array.from(this.children)) {
          if (child.localName.toLowerCase() === 'part') {
            parts.push(ctx.run(child, 'parsePart', { tempo }));
          }
        }
        return { type: 'score', title, tempo, parts };
      },

      // Directly play/schedule OscillatorNodes using AudioContext parameter
      playScore(ctx, audioCtx, opts = {}) {
        const title = this.querySelector('work-title, movement-title')?.textContent?.trim() || 'Untitled Score';
        let tempo = opts.bpm || 120;
        const soundEl = this.querySelector('sound[tempo]');
        if (soundEl && !opts.overrideBpm) tempo = parseFloat(soundEl.getAttribute('tempo')) || tempo;

        const startAudioTime = audioCtx.currentTime + 0.1;
        const parts = [];

        for (const child of Array.from(this.children)) {
          if (child.localName.toLowerCase() === 'part') {
            parts.push(ctx.run(child, 'playPart', audioCtx, { ...opts, tempo, startAudioTime }));
          }
        }
        return { title, tempo, parts };
      }
    });

    runner.define('element', 'part', {
      parsePart(ctx, initialMeta = {}) {
        let currentTime = 0;
        let divisions = 1;
        let tempo = initialMeta.tempo || 120;
        let lastNoteStartTime = 0;
        const notes = [];

        const measures = Array.from(this.querySelectorAll('measure'));
        measures.forEach((measure, mIndex) => {
          const mRes = ctx.run(measure, 'parseMeasure', {
            measureNumber: mIndex + 1,
            currentTime,
            divisions,
            tempo,
            lastNoteStartTime
          });
          notes.push(...mRes.notes);
          currentTime = mRes.currentTime;
          divisions = mRes.divisions;
          tempo = mRes.tempo;
          lastNoteStartTime = mRes.lastNoteStartTime;
        });

        return { id: this.getAttribute('id') || 'P1', notes };
      },

      playPart(ctx, audioCtx, opts = {}) {
        let currentTime = 0;
        let divisions = 1;
        let tempo = opts.tempo || 120;
        let lastNoteStartTime = 0;
        const notes = [];

        const measures = Array.from(this.querySelectorAll('measure'));
        measures.forEach((measure, mIndex) => {
          const mRes = ctx.run(measure, 'playMeasure', audioCtx, {
            ...opts,
            measureNumber: mIndex + 1,
            currentTime,
            divisions,
            tempo,
            lastNoteStartTime
          });
          notes.push(...mRes.notes);
          currentTime = mRes.currentTime;
          divisions = mRes.divisions;
          tempo = mRes.tempo;
          lastNoteStartTime = mRes.lastNoteStartTime;
        });

        return { id: this.getAttribute('id') || 'P1', notes };
      }
    });

    runner.define('element', 'measure', {
      parseMeasure(ctx, state) {
        let currentTime = state.currentTime;
        let divisions = state.divisions;
        let tempo = state.tempo;
        let lastNoteStartTime = state.lastNoteStartTime;
        const notes = [];

        for (const child of Array.from(this.children)) {
          const tag = child.localName.toLowerCase();

          if (tag === 'attributes') {
            const divEl = child.querySelector('divisions');
            if (divEl) divisions = parseInt(divEl.textContent.trim(), 10) || divisions;
          } else if (tag === 'direction') {
            const soundTempo = child.querySelector('sound')?.getAttribute('tempo');
            if (soundTempo) tempo = parseFloat(soundTempo);
          } else if (tag === 'note') {
            const noteData = ctx.run(child, 'parseNote', {
              measureNumber: state.measureNumber,
              divisions,
              currentTime,
              lastNoteStartTime
            });

            if (noteData.isChord) {
              noteData.startBeat = lastNoteStartTime;
            } else {
              noteData.startBeat = currentTime;
              lastNoteStartTime = currentTime;
              currentTime += noteData.durationInBeats;
            }

            notes.push(noteData);
          }
        }

        return { notes, currentTime, divisions, tempo, lastNoteStartTime };
      },

      playMeasure(ctx, audioCtx, opts = {}) {
        let currentTime = opts.currentTime;
        let divisions = opts.divisions;
        let tempo = opts.tempo;
        let lastNoteStartTime = opts.lastNoteStartTime;
        const notes = [];

        for (const child of Array.from(this.children)) {
          const tag = child.localName.toLowerCase();
          if (tag === 'attributes') {
            const divEl = child.querySelector('divisions');
            if (divEl) divisions = parseInt(divEl.textContent.trim(), 10) || divisions;
          } else if (tag === 'direction') {
            const soundTempo = child.querySelector('sound')?.getAttribute('tempo');
            if (soundTempo && !opts.overrideBpm) tempo = parseFloat(soundTempo);
          } else if (tag === 'note') {
            const noteRes = ctx.run(child, 'playNote', audioCtx, {
              ...opts,
              divisions,
              tempo,
              currentTime,
              lastNoteStartTime
            });

            if (noteRes.isChord) {
              noteRes.startBeat = lastNoteStartTime;
            } else {
              noteRes.startBeat = currentTime;
              lastNoteStartTime = currentTime;
              currentTime += noteRes.durationInBeats;
            }

            notes.push(noteRes);
          }
        }

        return { notes, currentTime, divisions, tempo, lastNoteStartTime };
      }
    });

    runner.define('element', 'note', {
      parseNote(ctx, state) {
        const isRest = this.querySelector('rest') !== null;
        const isChord = this.querySelector('chord') !== null;
        const durationEl = this.querySelector('duration');
        const durationTicks = durationEl ? parseInt(durationEl.textContent.trim(), 10) : state.divisions;
        const durationInBeats = durationTicks / (state.divisions || 1);

        let pitchName = 'Rest';
        let midi = 0;
        let frequency = 0;
        let step = '';
        let octave = 4;
        let alter = 0;

        if (!isRest) {
          const pitchEl = this.querySelector('pitch');
          if (pitchEl) {
            step = pitchEl.querySelector('step')?.textContent?.trim() || 'C';
            octave = parseInt(pitchEl.querySelector('octave')?.textContent?.trim() || '4', 10);
            alter = parseInt(pitchEl.querySelector('alter')?.textContent?.trim() || '0', 10);

            const stepMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
            const baseSemitone = stepMap[step.toUpperCase()] ?? 0;
            midi = (octave + 1) * 12 + baseSemitone + alter;
            frequency = 440 * Math.pow(2, (midi - 69) / 12);

            const alterSymbol = alter === 1 ? '♯' : alter === -1 ? '♭' : alter === 2 ? '𝄪' : '';
            pitchName = `${step}${alterSymbol}${octave}`;
          }
        }

        return {
          id: Math.random().toString(36).substring(2, 9),
          measureNumber: state.measureNumber,
          isRest,
          isChord,
          durationInBeats,
          durationTicks,
          pitchName,
          midi,
          frequency,
          step,
          octave,
          alter
        };
      },

      // Creates and triggers Web Audio API OscillatorNodes directly within the AST traversal
      playNote(ctx, audioCtx, opts = {}) {
        const isRest = this.querySelector('rest') !== null;
        const isChord = this.querySelector('chord') !== null;
        const durationEl = this.querySelector('duration');
        const durationTicks = durationEl ? parseInt(durationEl.textContent.trim(), 10) : opts.divisions;
        const durationInBeats = durationTicks / (opts.divisions || 1);

        const secondsPerBeat = 60 / (opts.tempo || 120);
        const startBeat = isChord ? opts.lastNoteStartTime : opts.currentTime;
        const durationSec = durationInBeats * secondsPerBeat;
        const startTimeSec = startBeat * secondsPerBeat;

        let pitchName = 'Rest';
        let midi = 0;
        let frequency = 0;
        const id = Math.random().toString(36).substring(2, 9);

        if (!isRest) {
          const pitchEl = this.querySelector('pitch');
          if (pitchEl) {
            const step = pitchEl.querySelector('step')?.textContent?.trim() || 'C';
            const octave = parseInt(pitchEl.querySelector('octave')?.textContent?.trim() || '4', 10);
            const alter = parseInt(pitchEl.querySelector('alter')?.textContent?.trim() || '0', 10);

            const stepMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
            const baseSemitone = stepMap[step.toUpperCase()] ?? 0;
            midi = (octave + 1) * 12 + baseSemitone + alter + (opts.transpose || 0);
            frequency = 440 * Math.pow(2, (midi - 69) / 12);

            const alterSymbol = alter === 1 ? '♯' : alter === -1 ? '♭' : alter === 2 ? '𝄪' : '';
            pitchName = `${step}${alterSymbol}${octave}`;

            // Direct OscillatorNode synthesis right inside XRunner!
            if (audioCtx && frequency > 0) {
              const osc = audioCtx.createOscillator();
              const noteGain = audioCtx.createGain();

              osc.type = opts.waveform || 'sine';
              const now = (opts.startAudioTime || audioCtx.currentTime) + startTimeSec;

              osc.frequency.setValueAtTime(frequency, now);

              const env = opts.envelope || { attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.2 };
              const sustainLevel = env.sustain;

              noteGain.gain.setValueAtTime(0, now);
              noteGain.gain.linearRampToValueAtTime(1.0, now + env.attack);
              noteGain.gain.linearRampToValueAtTime(sustainLevel, now + env.attack + env.decay);

              const noteReleaseStart = now + Math.max(durationSec, env.attack + env.decay);
              noteGain.gain.setValueAtTime(sustainLevel, noteReleaseStart);
              noteGain.gain.exponentialRampToValueAtTime(0.0001, noteReleaseStart + env.release);

              osc.connect(noteGain);
              noteGain.connect(opts.destination || audioCtx.destination);

              osc.start(now);
              osc.stop(noteReleaseStart + env.release + 0.1);
            }
          }
        }

        const noteData = {
          id,
          measureNumber: opts.measureNumber,
          isRest,
          isChord,
          durationInBeats,
          pitchName,
          midi,
          frequency,
          startBeat,
          startTimeSec,
          durationSec
        };

        if (typeof opts.onScheduleNote === 'function') {
          opts.onScheduleNote(noteData);
        }

        return noteData;
      }
    });

    return { name: 'MusicXMLAudioPlugin' };
  }
  return musicXMLAudioPlugin;
}));
