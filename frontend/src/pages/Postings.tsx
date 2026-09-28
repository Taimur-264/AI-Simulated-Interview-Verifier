/**
 * Postings - admin job posting manager (admin console, NFR-SEC-02).
 *
 * Create/edit/close postings and manage each posting's custom questions.
 * Interviews for a posting draw 5 questions: the posting's own questions
 * first, topped up from the shared 40-question bank.
 *
 * Route: /admin/postings (admin role only - recruiters get a clear gate).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Textarea,
} from '../components';
import { AdminShell } from './Admin';
import { useAuth } from '../hooks/useAuth';
import { postingService } from '../services/api';
import type { AdminJobPosting } from '../types';

interface FormState {
  title: string;
  department: string;
  location: string;
  duration_minutes: number;
  description: string;
}

const EMPTY_FORM: FormState = {
  title: '',
  department: '',
  location: '',
  duration_minutes: 60,
  description: '',
};

const TYPE_META: Record<string, { label: string; cls: string }> = {
  mcq: { label: 'MCQ', cls: 'border-purple-200 bg-purple-50 text-purple-700' },
  text: { label: 'Written', cls: 'border-blue-200 bg-blue-50 text-blue-700' },
  coding: { label: 'Coding', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};

function TypeBadge({ type }: { type: string }) {
  const meta = TYPE_META[type] ?? TYPE_META.text;
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
  );
}

function apiError(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  return fallback;
}

// ---- question form ----

function QuestionForm({
  postingId,
  onSaved,
  onCancel,
}: {
  postingId: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<'text' | 'mcq' | 'coding'>('text');
  const [text, setText] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [answerIndex, setAnswerIndex] = useState('0');
  const [modelAnswer, setModelAnswer] = useState('');
  const [timeLimit, setTimeLimit] = useState(300);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optionLines = useMemo(
    () =>
      optionsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    [optionsText],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!text.trim()) {
      setError('Question text is required.');
      return;
    }
    if (type === 'mcq') {
      if (optionLines.length < 2) {
        setError('An MCQ needs at least two options - one per line.');
        return;
      }
      if (Number(answerIndex) >= optionLines.length) {
        setError('Pick the correct option.');
        return;
      }
    }
    setSaving(true);
    try {
      await postingService.addQuestion(postingId, {
        text: text.trim(),
        type,
        options: type === 'mcq' ? optionLines : null,
        answer_index: type === 'mcq' ? Number(answerIndex) : null,
        model_answer: type === 'mcq' ? null : modelAnswer.trim() || null,
        time_limit: Number(timeLimit) || 300,
      });
      // Reset for the next question - keep the form open to add several
      setText('');
      setOptionsText('');
      setModelAnswer('');
      setAnswerIndex('0');
      onSaved();
    } catch (err) {
      setError(apiError(err, 'Could not save the question.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Type</label>
        <div className="flex gap-1.5">
          {(['text', 'mcq', 'coding'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                type === value
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {TYPE_META[value].label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-gray-400">Graded on the completion screen + dashboard</span>
      </div>

      <Textarea
        label="Question"
        rows={3}
        required
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={type === 'coding' ? 'Write a function that ...' : 'Explain the difference between ...'}
      />

      {type === 'mcq' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Textarea
            label="Options (one per line)"
            rows={4}
            value={optionsText}
            onChange={(e) => {
              setOptionsText(e.target.value);
              setAnswerIndex('0');
            }}
            placeholder={'First option\nSecond option\nThird option'}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Correct option</label>
            <select
              value={answerIndex}
              onChange={(e) => setAnswerIndex(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {optionLines.length === 0 && <option value="0">Add options first...</option>}
              {optionLines.map((line, index) => (
                <option key={index} value={String(index)}>
                  {index + 1}. {line.length > 60 ? `${line.slice(0, 60)}…` : line}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-gray-500">The candidate's exact choice is graded on submit.</p>
          </div>
        </div>
      )}

      {type !== 'mcq' && (
        <Textarea
          label={type === 'coding' ? 'Model answer / expected keywords' : 'Model answer (keywords are graded)'}
          rows={3}
          value={modelAnswer}
          onChange={(e) => setModelAnswer(e.target.value)}
          placeholder="Reference answer used for keyword-coverage grading..."
          helperText="Written/coding answers pass with about 35% keyword coverage. Leave empty for unscored practice."
        />
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-40">
          <Input
            label="Time limit (seconds)"
            type="number"
            min={15}
            max={3600}
            value={timeLimit}
            onChange={(e) => setTimeLimit(Number(e.target.value))}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={saving}>
            Add question
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Done
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

// ---- page ----

export function Postings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [items, setItems] = useState<AdminJobPosting[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // create/edit form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminJobPosting | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // per-posting UI state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [questionFormFor, setQuestionFormFor] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const reload = useCallback(() => {
    postingService
      .adminList()
      .then((data) => setItems(data))
      .catch(() => setError('Could not load postings. Is the backend running?'));
  }, []);

  useEffect(() => {
    if (isAdmin) reload();
  }, [isAdmin, reload]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (posting: AdminJobPosting) => {
    setEditing(posting);
    setForm({
      title: posting.title,
      department: posting.department || '',
      location: posting.location || '',
      duration_minutes: posting.duration_minutes,
      description: posting.description || '',
    });
    setFormError(null);
    setFormOpen(true);
    setExpandedId(null);
    setQuestionFormFor(null);
  };

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError('Posting name is required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      title: form.title.trim(),
      department: form.department.trim() || null,
      location: form.location.trim() || null,
      description: form.description.trim() || null,
      duration_minutes: Number(form.duration_minutes) || 60,
    };
    try {
      if (editing) await postingService.update(editing.id, payload);
      else await postingService.create(payload);
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      reload();
    } catch (err) {
      setFormError(apiError(err, 'Could not save the posting.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (posting: AdminJobPosting) => {
    try {
      await postingService.update(posting.id, { is_active: !posting.is_active });
      reload();
    } catch (err) {
      setError(apiError(err, 'Could not update the posting.'));
    }
  };

  const deletePosting = async (posting: AdminJobPosting) => {
    try {
      await postingService.remove(posting.id);
      setConfirmDeleteId(null);
      if (expandedId === posting.id) {
        setExpandedId(null);
        setQuestionFormFor(null);
      }
      reload();
    } catch (err) {
      setError(apiError(err, 'Could not delete the posting.'));
    }
  };

  const deleteQuestion = async (postingId: number, questionId: number) => {
    try {
      await postingService.removeQuestion(postingId, questionId);
      reload();
    } catch (err) {
      setError(apiError(err, 'Could not delete the question.'));
    }
  };

  if (!isAdmin) {
    return (
      <AdminShell>
        <Card>
          <CardContent className="py-10 text-center">
            <h1 className="text-xl font-semibold text-gray-900">Admin access required</h1>
            <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500">
              Job postings and questions can only be managed by console administrators (NFR-SEC-02). Your role is{' '}
              <span className="font-medium capitalize">{user?.role || 'unknown'}</span>.
            </p>
          </CardContent>
        </Card>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job postings</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Create the positions candidates can apply to, name them, and attach custom questions. Interviews draw 5
            questions - your custom ones first, topped up from the shared bank.
          </p>
        </div>
        <Button onClick={openCreate} disabled={formOpen && editing === null}>
          + New posting
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error}</div>
      )}

      {/* Create / edit form */}
      {formOpen && (
        <Card className="mb-6 border-blue-200">
          <CardHeader>
            <CardTitle className="text-lg">{editing ? `Edit "${editing.title}"` : 'New job posting'}</CardTitle>
            <CardDescription>
              The posting name is what candidates see on the position board and what the interview is titled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitForm} className="space-y-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Posting name *"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Frontend Engineer"
                />
                <Input
                  label="Department"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  placeholder="e.g. Engineering"
                />
                <Input
                  label="Location"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Remote / Hybrid - Office"
                />
                <Input
                  label="Duration (minutes)"
                  type="number"
                  min={5}
                  max={480}
                  value={form.duration_minutes}
                  onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                />
              </div>
              <Textarea
                label="Description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What the role does, what the interview covers..."
              />
              {formError && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700" role="alert">
                  {formError}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={saving}>
                  {editing ? 'Save changes' : 'Create posting'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setFormOpen(false);
                    setEditing(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Posting list */}
      {items === null ? (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-gray-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Loading postings...
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500">
            No postings yet - create the first position with <strong>+ New posting</strong>.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((posting) => {
            const expanded = expandedId === posting.id;
            const confirming = confirmDeleteId === posting.id;
            return (
              <Card key={posting.id}>
                <CardContent>
                  {/* Row 1: identity */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">{posting.title}</h2>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            posting.is_active
                              ? 'border-green-200 bg-green-50 text-green-700'
                              : 'border-gray-200 bg-gray-100 text-gray-500'
                          }`}
                        >
                          {posting.is_active ? 'Open' : 'Closed'}
                        </span>
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          {posting.question_count} custom {posting.question_count === 1 ? 'question' : 'questions'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        {[posting.department, posting.location, `${posting.duration_minutes} min`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {posting.description && (
                        <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-gray-600">{posting.description}</p>
                      )}
                    </div>

                    {/* Row 1: actions */}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setExpandedId(expanded ? null : posting.id);
                          setQuestionFormFor(null);
                        }}
                      >
                        {expanded ? 'Hide questions' : 'Manage questions'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(posting)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(posting)}>
                        {posting.is_active ? 'Close' : 'Reopen'}
                      </Button>
                      {confirming ? (
                        <span className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs">
                          <span className="text-red-700">Delete? History is kept.</span>
                          <button
                            type="button"
                            className="font-semibold text-red-700 underline"
                            onClick={() => deletePosting(posting)}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            className="text-gray-500 underline"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setConfirmDeleteId(posting.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Question manager */}
                  {expanded && (
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">Custom questions</p>
                        <Button size="sm" onClick={() => setQuestionFormFor(questionFormFor === posting.id ? null : posting.id)}>
                          {questionFormFor === posting.id ? 'Close form' : '+ Add question'}
                        </Button>
                      </div>

                      {posting.questions.length === 0 ? (
                        <p className="mb-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-500">
                          No custom questions yet - interviews for this posting draw 5 questions from the shared
                          bank. Add your own to tailor the interview to the role.
                        </p>
                      ) : (
                        <ul className="mb-3 space-y-2">
                          {posting.questions.map((question, index) => (
                            <li
                              key={question.id}
                              className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3"
                            >
                              <span className="mt-0.5 w-5 shrink-0 text-center text-xs font-bold text-gray-400">
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <TypeBadge type={question.type} />
                                  <span className="text-xs text-gray-400">{question.time_limit}s limit</span>
                                  {question.type === 'mcq' &&
                                    question.options &&
                                    question.answer_index != null && (
                                      <span className="truncate text-xs text-gray-400">
                                        correct: {question.options[question.answer_index]}
                                      </span>
                                    )}
                                </div>
                                <p className="mt-1 break-words text-sm text-gray-800">{question.text}</p>
                              </div>
                              <button
                                type="button"
                                className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                                onClick={() => deleteQuestion(posting.id, question.id)}
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      {questionFormFor === posting.id && (
                        <QuestionForm
                          postingId={posting.id}
                          onSaved={reload}
                          onCancel={() => setQuestionFormFor(null)}
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
