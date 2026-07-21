import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type Question = {
  question_id: string;
  question_text: string;
  options: Record<string, string>;
  correct_option: string;
  difficulty_level: number;
  category: string | null;
  image_url: string | null;
  time_limit_seconds: number;
};

type QuestionDraft = {
  id: string;
  question_text: string;
  options: Record<string, string>;
  correct_option: string;
  difficulty_level: number;
  category: string | null;
  image_url: string | null;
  status: string;
  generated_by: string;
  created_at: string;
};

type ContentBudget = {
  budgetCents: number;
  skimBps: number;
  estCostCentsPerCall: number;
  affordableCalls: number;
};

type TopicSuggestion = {
  id: string;
  user_id: string;
  suggestion_text: string;
  status: string;
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
  image_url: '',
  time_limit_seconds: 12,
};

export default function QuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [genCategory, setGenCategory] = useState('');
  const [genRoundStart, setGenRoundStart] = useState(1);
  const [genRoundEnd, setGenRoundEnd] = useState(10);
  const [genBusy, setGenBusy] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<SubjectCoverage[]>([]);
  const [coverageFilter, setCoverageFilter] = useState('');
  const [suggestions, setSuggestions] = useState<TopicSuggestion[]>([]);
  const [suggestionBusy, setSuggestionBusy] = useState<string | null>(null);
  const [autoCurateBusy, setAutoCurateBusy] = useState(false);
  const [autoCurateMessage, setAutoCurateMessage] = useState<string | null>(null);
  const [ignoreBudget, setIgnoreBudget] = useState(false);
  const [budget, setBudget] = useState<ContentBudget | null>(null);
  const [skimPct, setSkimPct] = useState('10');
  const [estCostCents, setEstCostCents] = useState('10');
  const [budgetSettingsBusy, setBudgetSettingsBusy] = useState(false);
  const [budgetSettingsMessage, setBudgetSettingsMessage] = useState<string | null>(null);
  const budgetFormInitialized = useRef(false);

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

    const { data: sugg } = await supabase
      .from('topic_suggestions')
      .select('*')
      .eq('status', 'new')
      .order('created_at', { ascending: false });
    if (sugg) setSuggestions(sugg as TopicSuggestion[]);

    const { data: budgetData } = await supabase.rpc('content_budget_status');
    if (budgetData) {
      const b = budgetData as ContentBudget;
      setBudget(b);
      if (!budgetFormInitialized.current) {
        setSkimPct(String(b.skimBps / 100));
        setEstCostCents(String(b.estCostCentsPerCall));
        budgetFormInitialized.current = true;
      }
    }
  }, []);

  async function setSuggestionStatus(id: string, status: 'reviewed' | 'dismissed') {
    setSuggestionBusy(id);
    try {
      const { error } = await supabase.rpc('admin_set_topic_suggestion_status', { p_id: id, p_status: status });
      if (error) throw error;
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setSuggestionBusy(null);
    }
  }

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

  // Same drafting engine as Trivia Alchemist above, but scans the whole
  // subject taxonomy for shortfalls instead of one category at a time - this
  // also runs automatically every 30 minutes via a scheduled cron job.
  // "Run now" just fires an extra pass on demand; both write to the same
  // pending_review queue below, so nothing here skips human review.
  async function runAutoCurate() {
    setAutoCurateBusy(true);
    setAutoCurateMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('auto-curate-questions', {
        body: { maxSubjects: 5, targetPerGrade: 5, ignoreBudget },
      });
      if (error) throw error;
      if (data.skippedReason) {
        setAutoCurateMessage(data.skippedReason);
      } else {
        const summary = (data.perSubjectResults as { slug: string; drafted: number }[])
          .map((r) => `${r.slug} +${r.drafted}`)
          .join(', ');
        setAutoCurateMessage(
          `Checked ${data.subjectsProcessed} subject(s), drafted ${data.drafted} question(s)${summary ? ` (${summary})` : ''}. Review below.`
        );
      }
      await load();
    } catch (err) {
      setAutoCurateMessage(`Error: ${(err as Error).message}`);
    } finally {
      setAutoCurateBusy(false);
    }
  }

  async function saveBudgetSettings() {
    setBudgetSettingsBusy(true);
    setBudgetSettingsMessage(null);
    try {
      const skimBps = Math.round(Number(skimPct) * 100);
      const estCost = Math.round(Number(estCostCents));
      if (!Number.isFinite(skimBps) || !Number.isFinite(estCost)) throw new Error('Enter valid numbers');
      const { error } = await supabase.rpc('admin_update_content_budget_settings', {
        p_skim_bps: skimBps,
        p_est_cost_cents_per_call: estCost,
      });
      if (error) throw error;
      setBudgetSettingsMessage('Saved.');
      await load();
    } catch (err) {
      setBudgetSettingsMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBudgetSettingsBusy(false);
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
      image_url: q.image_url ?? '',
      time_limit_seconds: q.time_limit_seconds,
    });
  }

  // Upload a picture to the public question-images bucket (staff-write via RLS) and
  // put its public URL in the form. Used for "identify this image" fraud-resistant
  // questions.
  async function uploadImage(file: File) {
    setUploadingImage(true);
    setMessage(null);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${(form.category || 'misc').toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('question-images').upload(path, file, {
        cacheControl: '31536000',
        contentType: file.type || undefined,
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from('question-images').getPublicUrl(path);
      setForm((f) => ({ ...f, image_url: data.publicUrl }));
      setMessage('Image uploaded.');
    } catch (err) {
      setMessage(`Image upload failed: ${(err as Error).message}`);
    } finally {
      setUploadingImage(false);
    }
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
        p_image_url: form.image_url || null,
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

      {suggestions.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Player topic suggestions ({suggestions.length})</h3>
          <p style={{ color: '#9a9aa5', fontSize: 13 }}>
            Submitted from the app's "Suggest a topic or question" box. Mark reviewed once you've acted on it (e.g.
            added a subject or drafted a question from it), or dismiss if it's not usable.
          </p>
          <table>
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Suggestion</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => (
                <tr key={s.id}>
                  <td style={{ color: '#9a9aa5', whiteSpace: 'nowrap' }}>{new Date(s.created_at).toLocaleDateString()}</td>
                  <td>{s.suggestion_text}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setSuggestionStatus(s.id, 'reviewed')} disabled={suggestionBusy === s.id}>
                      Mark reviewed
                    </button>
                    <button className="danger" onClick={() => setSuggestionStatus(s.id, 'dismissed')} disabled={suggestionBusy === s.id}>
                      Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', color: '#9a9aa5', fontSize: 13, marginBottom: 6 }}>
              Picture (optional) — for fraud-resistant "identify this image" questions
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                style={{ flex: 1, minWidth: 220 }}
                placeholder="Image URL (or upload a file →)"
                value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
              />
              <input
                type="file"
                accept="image/*"
                disabled={uploadingImage}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadImage(file);
                  e.target.value = '';
                }}
              />
              {uploadingImage && <span style={{ color: '#9a9aa5', fontSize: 13 }}>Uploading…</span>}
              {form.image_url && (
                <button type="button" className="secondary" onClick={() => setForm({ ...form, image_url: '' })}>
                  Remove
                </button>
              )}
            </div>
            {form.image_url && (
              <img
                src={form.image_url}
                alt="question preview"
                style={{ marginTop: 10, maxHeight: 120, borderRadius: 8, border: '1px solid #1c1c24' }}
              />
            )}
          </div>
          <button type="submit" disabled={busy || uploadingImage}>
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
        <h3 style={{ marginTop: 0 }}>Auto-Curate (whole taxonomy)</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Automatically scans every subject for shortfalls and drafts questions for whichever ones need them most -
          same review queue as Trivia Alchemist below, nothing goes live without approval. This also runs on its own
          every 30 minutes via a scheduled job; "Run now" just triggers an extra pass (a handful of subjects per run,
          so it stays fast and bounded).
        </p>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          <b>Self-funded by tournament revenue:</b> a slice of each completed game's house cut tops up a content
          budget, and the scheduled runs only spend what's actually been earned - no tournaments played yet means no
          automatic spend yet.
        </p>
        {budget && (
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="label">Content budget</div>
              <div className="value">${(budget.budgetCents / 100).toFixed(2)}</div>
            </div>
            <div className="stat">
              <div className="label">Affordable runs left</div>
              <div className="value">{budget.affordableCalls}</div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#9a9aa5' }}>
            Skim % of house revenue per completed game
            <input type="number" min={0} max={100} step={0.1} value={skimPct} onChange={(e) => setSkimPct(e.target.value)} style={{ width: 140 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#9a9aa5' }}>
            Est. cost per generation call (cents)
            <input type="number" min={1} value={estCostCents} onChange={(e) => setEstCostCents(e.target.value)} style={{ width: 140 }} />
          </label>
          <button className="secondary" onClick={saveBudgetSettings} disabled={budgetSettingsBusy} style={{ alignSelf: 'flex-end' }}>
            {budgetSettingsBusy ? 'Saving...' : 'Save settings'}
          </button>
        </div>
        {budgetSettingsMessage && <p style={{ marginTop: 0, marginBottom: 12 }}>{budgetSettingsMessage}</p>}

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#cbd5f5', marginBottom: 10 }}>
          <input type="checkbox" checked={ignoreBudget} onChange={(e) => setIgnoreBudget(e.target.checked)} />
          Ignore content budget for this run (bills your normal Anthropic account right away - use to seed a brand-new
          topic before any tournament has funded it)
        </label>
        <div>
          <button onClick={runAutoCurate} disabled={autoCurateBusy}>
            {autoCurateBusy ? 'Curating...' : '🤖 Run now'}
          </button>
        </div>
        {autoCurateMessage && <p style={{ marginTop: 12 }}>{autoCurateMessage}</p>}
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
                  <td>
                    {d.image_url && (
                      <img src={d.image_url} alt="" style={{ height: 32, borderRadius: 4, marginRight: 8, verticalAlign: 'middle' }} />
                    )}
                    {d.question_text}
                  </td>
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
                <td>
                  {q.image_url && (
                    <img src={q.image_url} alt="" style={{ height: 32, borderRadius: 4, marginRight: 8, verticalAlign: 'middle' }} />
                  )}
                  {q.question_text}
                </td>
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
