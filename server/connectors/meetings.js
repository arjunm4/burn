// Meeting-notes connector: reads a folder of exported notes (Granola, Otter, a shared doc) as
// Markdown and turns each one into Documents: the overview as one, then every attributed line
// of the discussion or transcript as its own, so a statement keeps who said it and when.
// There is no live transport: note-taking tools export files, and a synced folder is the feed.
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';

const MONTHS = {jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11};
const ZONES = {PST: '-08:00', PDT: '-07:00', MST: '-07:00', MDT: '-06:00', CST: '-06:00', CDT: '-05:00', EST: '-05:00', EDT: '-04:00', UTC: 'Z', GMT: 'Z'};

// "Tue, Nov 3, 2026 · 10:30 AM PST" -> ISO. Falls back to the file name's date (YYYY-MM-DD[-HHMM]).
export function parseWhen(dateLine, fileName) {
  const m = /([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})(?:.*?(\d{1,2}):(\d{2}) ?([AP]M)?(?: ([A-Z]{3,4}))?)?/.exec(dateLine || '');
  if (m && m[1].toLowerCase() in MONTHS) {
    let h = m[4] ? Number(m[4]) : 9; const min = m[5] ? Number(m[5]) : 0;
    if (m[6] === 'PM' && h < 12) h += 12; if (m[6] === 'AM' && h === 12) h = 0;
    const zone = ZONES[m[7]] || '-08:00';
    const pad = n => String(n).padStart(2, '0');
    return new Date(`${m[3]}-${pad(MONTHS[m[1].toLowerCase()] + 1)}-${pad(m[2])}T${pad(h)}:${pad(min)}:00${zone}`).toISOString();
  }
  const f = /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2}))?/.exec(fileName || '');
  return f ? new Date(`${f[1]}-${f[2]}-${f[3]}T${f[4] || '09'}:${f[5] || '00'}:00-08:00`).toISOString() : null;
}

/** parseMeeting(markdown, fileName) -> Document[] */
export function parseMeeting(text, fileName) {
  const title = /^#\s+(.+)$/m.exec(text)?.[1].trim() || fileName;
  const field = k => new RegExp(`^-\\s+\\*\\*${k}:\\*\\*\\s*(.+)$`, 'mi').exec(text)?.[1].trim() || null;
  const at = parseWhen(field('Date'), fileName);
  if (!at) return [];
  const participants = (field('Participants') || '').split(/,\s*/).filter(Boolean);
  const base = `meeting:${fileName.replace(/\.md$/, '')}`;
  const section = name => { const m = new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\r\\n]))`, 'mi').exec(text); return m ? m[1].trim() : ''; };
  const docs = [];
  const overview = section('Overview');
  if (overview) docs.push({id: base, source: 'meetings', kind: 'meeting', externalId: fileName, channel: title, author: null, at, end: null, text: `${title}\n${overview}`, url: null, attrs: {participants, notesBy: field('Notes by'), duration: field('Duration')}});
  let n = 0;
  const line = (speaker, said, offsetSec) => {
    n++;
    docs.push({id: `${base}:${n}`, source: 'meetings', kind: 'utterance', externalId: `${fileName}#${n}`, channel: title, author: speaker.trim(),
      at: new Date(Date.parse(at) + offsetSec * 1000).toISOString(), end: null, text: said.trim(), url: null, attrs: {meeting: base, participants}});
  };
  // Transcript lines "[26:07] Samir Khoury: ..." win when present; otherwise the discussion bullets "- Dmitri: ...".
  const transcript = section('Transcript');
  if (transcript) {
    for (const row of transcript.split('\n')) { const m = /^\[(\d+):(\d{2})\]\s+([^:]+):\s*(.+)$/.exec(row); if (m) line(m[3], m[4], Number(m[1]) * 60 + Number(m[2])); }
  } else {
    let i = 0;
    for (const row of section('Discussion').split('\n')) { const m = /^-\s+([^:]+?):\s*(.+)$/.exec(row); if (m) line(m[1], m[2], 60 * i++); }
  }
  return docs;
}

/** fetchMeetings({dir}) -> Document[] for every .md note in the folder. */
export async function fetchMeetings({dir}) {
  const files = (await readdir(dir)).filter(f => f.endsWith('.md')).sort();
  const docs = [];
  for (const f of files) docs.push(...parseMeeting(await readFile(path.join(dir, f), 'utf8'), f));
  return docs.sort((a, b) => a.at.localeCompare(b.at));
}
