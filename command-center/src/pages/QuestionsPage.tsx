import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Question = {
  question_id: string;
  question_text: string;
  options: Record<string, string>;
  correct_option: string;
  difficulty_level: number;
  category: string | null;
  time_limit_seconds: number;
};

type QuestionDraft = {
  id: string;
  question_text: string;
  options: Record<string, string>;
  correct_option: string;
  difficulty_level: number;
  category: string | null;
  status: string;
  generated_by: string;
  created_at: string;
};

type SubjectCoverage = {
  subject_id: string;
  slug: string;
  name: string;
  domain: string;
  target_question_count: number;
  approved_count: number;
  pending_count: number;
  rejected_count: number;
  grade_levels_covered: number;
};

type ItemAnalytics = {
  question_id: string;
  question_text: string;
  category: string | null;
  grade_level: number | null;
  times_answered: number;
  correct_count: number;
  correct_rate: number;
  avg_score_correct: number | null;
  avg_score_wrong: number | null;
  discrimination: number | null;
};

const emptyForm = {
  question_id: null as string | null,
  question_text: '',
  optionA: '',
  optionB: '',
  optionC: '',
  optionD: '',
  correct_option: 'A',
  difficulty_level: 1,
  category: '',
  time_limit_seconds: 12,
};

export default function QuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [genCategory, setGenCategory] = useState('');
  const [genRoundStart, setGenRoundStart] = useState(1);
  const [genRoundEnd, setGenRoundEnd] = useState(10);
  const [genBusy, setGenBusy] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<SubjectCoverage[]>([]);
  const [coverageFilter, setCoverageFilter] = useState('');
  const [items, setItems] = useState<ItemAnalytics[]>([]);
  const [itemBusy, setItemBusy] = useState(false);
  const [itemMsg, setItemMsg] = useState<string | null>(null);

  async function loadItemAnalytics() {
    setItemBusy(true);
    setItemMsg(null);
    // p_min_answered=1 so early data still shows; raise it once you have volume.
    const { data, error } = await supabase.rpc('question_item_analytics', { p_min_answered: 1 });
    if (error) setItemMsg(`Error: ${error.message}`);
    else {
      setItems((data ?? []) as ItemAnalytics[]);
      if (!data?.length) setItemMsg('No questions have been answered enough times yet.');
    }
    setItemBusy(false);
  }

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .order('difficulty_level', { ascending: true })
      .limit(200);
    if (!error && data) setQuestions(data as Question[]);

    const { data: draftData } = await supabase
      .from('question_drafts')
      .select('*')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false });
    if (draftData) setDrafts(draftData as QuestionDraft[]);

    const { data: cov } = await supabase.rpc('subject_curation_status');
    if (cov) setCoverage(cov as SubjectCoverage[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // "Trivia Alchemist": requests AI-drafted questions for staff review. Never
  // writes to the live question bank directly - see promote/reject below.
  async function generateDrafts() {
    setGenBusy(true);
    setGenMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-questions', {
        body: { category: genCategory || undefined, roundStart: genRoundStart, roundEnd: genRoundEnd },
      });
      if (error) throw error;
      setGenMessage(`Drafted ${data.drafted} question(s)${data.skipped ? `, skipped ${data.skipped} malformed` : ''}. Review below.`);
      await load();
    } catch (err) {
      setGenMessage(`Error: ${(err as Error).message}`);
    } finally {
      setGenBusy(false);
    }
  }

  async function promoteDraft(id: string) {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('promote_question_draft', { p_draft_id: id });
      if (error) throw error;
      await load();
    } catch (err) {
      setGenMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function rejectDraft(id: string) {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('reject_question_draft', { p_draft_id: id });
      if (error) throw error;
      await load();
    } catch (err) {
      setGenMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function editQuestion(q: Question) {
    setForm({
      question_id: q.question_id,
      question_text: q.question_text,
      optionA: q.options.A ?? '',
      optionB: q.options.B ?? '',
      optionC: q.options.C ?? '',
      optionD: q.options.D ?? '',
      correct_option: q.correct_option,
      difficulty_level: q.difficulty_level,
      category: q.category ?? '',
      time_limit_seconds: q.time_limit_seconds,
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_upsert_question', {
        p_question_id: form.question_id,
        p_question_text: form.question_text,
        p_options: { A: form.optionA, B: form.optionB, C: form.optionC, D: form.optionD },
        p_correct_option: form.correct_option,
        p_difficulty_level: form.difficulty_level,
        p_category: form.category || null,
        p_time_limit_seconds: form.time_limit_seconds,
      });
      if (error) throw error;
      setMessage('Saved.');
      setForm(emptyForm);
      await load();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const filtered = questions.filter(
    (q) => !filter || q.question_text.toLowerCase().includes(filter.toLowerCase()) || String(q.difficulty_level) === filter
  );

  const readyCount = coverage.filter((c) => c.grade_levels_covered >= 20).length;
  const coverageShown = coverage.filter(
    (c) => !coverageFilter || c.name.toLowerCase().includes(coverageFilter.toLowerCase()) || c.domain.toLowerCase().includes(coverageFilter.toLowerCase())
  );

  return (
    <div>
      <h2>Question Bank</h2>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Curation coverage</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Target: 500 approved questions/subject (25 per grade level × 20 grades). A subject is contest-ready once all
          20 grade levels have questions. <strong>{readyCount}</strong> of <strong>{coverage.length}</strong> subjects
          ready.
        </p>
        <input
          placeholder="Filter subjects by name or domain"
          value={coverageFilter}
          onChange={(e) => setCoverageFilter(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Domain</th>
              <th>Approved / Target</th>
              <th>Grades</th>
              <th>Pending</th>
            </tr>
          </thead>
          <tbody>
            {coverageShown.slice(0, 60).map((c) => {
              const pct = Math.min(100, Math.round((c.approved_count / c.target_question_count) * 100));
              const ready = c.grade_levels_covered >= 20;
              return (
                <tr key={c.subject_id}>
                  <td>{c.name}</td>
                  <td style={{ color: '#9a9aa5' }}>{c.domain}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 8, background: '#1c1c24', borderRadius: 4, overflow: 'hidden', minWidth: 80 }}>
                        <div style={{ width: `${pct}%`, height: 8, background: ready ? '#12E29A' : '#FFD23F' }} />
                      </div>
                      <span style={{ fontSize: 12, color: '#9a9aa5' }}>
                        {c.approved_count}/{c.target_question_count}
                      </span>
                    </div>
                  </td>
                  <td style={{ color: ready ? '#12E29A' : '#9a9aa5' }}>{c.grade_levels_covered}/20</td>
                  <td>{c.pending_count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {coverage.length === 0 && <p style={{ color: '#9a9aa5' }}>No subjects seeded yet. Run the subjects seed migration.</p>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Item analytics (difficulty calibration)</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          How each played question behaves. <strong>Correct rate</strong> should trend down as grade rises;{' '}
          <strong>discrimination</strong> (avg game score of players who got it right minus those who got it wrong)
          should be clearly positive. Low/negative discrimination = the question isn't measuring skill (ambiguous or
          miscalibrated) — review or re-tier it. Rows sorted worst-discrimination first.
        </p>
        <button onClick={loadItemAnalytics} disabled={itemBusy}>
          {itemBusy ? 'Loading…' : 'Load item analytics'}
        </button>
        {itemMsg && <p style={{ marginTop: 12 }}>{itemMsg}</p>}
        {items.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Grade</th>
                <th>Question</th>
                <th>Answered</th>
                <th>Correct rate</th>
                <th>Discrimination</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const weak = it.discrimination != null && it.discrimination <= 0;
                return (
                  <tr key={it.question_id}>
                    <td>{it.grade_level ?? '—'}</td>
                    <td>{it.question_text}</td>
                    <td>{it.times_answered}</td>
                    <td>{it.correct_rate != null ? `${Math.round(it.correct_rate * 100)}%` : '—'}</td>
                    <td style={{ color: weak ? '#ef4444' : '#12E29A', fontWeight: 700 }}>
                      {it.discrimination ?? '—'}
                      {weak ? ' ⚠' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{form.question_id ? 'Edit question' : 'Add question'}</h3>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 10 }}>
            <textarea
              placeholder="Question text"
              value={form.question_text}
              onChange={(e) => setForm({ ...form, question_text: e.target.value })}
              rows={2}
              required
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Option A" value={form.optionA} onChange={(e) => setForm({ ...form, optionA: e.target.value })} required />
            <input placeholder="Option B" value={form.optionB} onChange={(e) => setForm({ ...form, optionB: e.target.value })} required />
            <input placeholder="Option C" value={form.optionC} onChange={(e) => setForm({ ...form, optionC: e.target.value })} required />
            <input placeholder="Option D" value={form.optionD} onChange={(e) => setForm({ ...form, optionD: e.target.value })} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <select value={form.correct_option} onChange={(e) => setForm({ ...form, correct_option: e.target.value })}>
              {['A', 'B', 'C', 'D'].map((o) => (
                <option key={o} value={o}>
                  Correct: {o}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={100}
              placeholder="Round (1-100)"
              value={form.difficulty_level}
              onChange={(e) => setForm({ ...form, difficulty_level: Number(e.target.value) })}
              required
            />
            <input placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <input
              type="number"
              min={3}
              max={60}
              placeholder="Time limit (s)"
              value={form.time_limit_seconds}
              onChange={(e) => setForm({ ...form, time_limit_seconds: Number(e.target.value) })}
            />
          </div>
          <button type="submit" disabled={busy}>
            {form.question_id ? 'Save changes' : 'Add question'}
          </button>{' '}
          {form.question_id && (
            <button type="button" className="secondary" onClick={() => setForm(emptyForm)}>
              Cancel edit
            </button>
          )}
          {message && <p style={{ marginTop: 12 }}>{message}</p>}
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Trivia Alchemist (AI drafts)</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Generates draft questions for review - nothing is added to the live game until you approve it below. Requires
          <code> ANTHROPIC_API_KEY</code> set as an Edge Function secret.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10 }}>
          <input placeholder="Category (optional)" value={genCategory} onChange={(e) => setGenCategory(e.target.value)} />
          <input type="number" min={1} max={100} placeholder="From round" value={genRoundStart} onChange={(e) => setGenRoundStart(Number(e.target.value))} />
          <input type="number" min={1} max={100} placeholder="To round" value={genRoundEnd} onChange={(e) => setGenRoundEnd(Number(e.target.value))} />
          <button onClick={generateDrafts} disabled={genBusy}>
            {genBusy ? 'Drafting...' : 'Generate drafts'}
          </button>
        </div>
        {genMessage && <p style={{ marginTop: 12 }}>{genMessage}</p>}

        {drafts.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Round</th>
                <th>Question</th>
                <th>Correct</th>
                <th>Category</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td>{d.difficulty_level}</td>
                  <td>{d.question_text}</td>
                  <td>{d.correct_option}</td>
                  <td>{d.category}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => promoteDraft(d.id)} disabled={busy}>
                      Approve
                    </button>
                    <button className="danger" onClick={() => rejectDraft(d.id)} disabled={busy}>
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <input placeholder="Filter by text or round number" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 12 }} />
        <table>
          <thead>
            <tr>
              <th>Round</th>
              <th>Question</th>
              <th>Correct</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((q) => (
              <tr key={q.question_id}>
                <td>{q.difficulty_level}</td>
                <td>{q.question_text}</td>
                <td>{q.correct_option}</td>
                <td>{q.category}</td>
                <td>
                  <button className="secondary" onClick={() => editQuestion(q)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
