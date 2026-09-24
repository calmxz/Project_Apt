// PROTOTYPE fixture for /prototype/profile. Shaped exactly like
// AggregateProfileResponse (docs/api/openapi.yaml) so the variants render the
// same fields the real endpoint carries and nothing more (PRODUCT.md
// principle 5: no visual claim the backend cannot verify).

// n days and h hours before now, so every stamp reads as the past.
function daysAgo(n, h = 3) {
  return new Date(Date.now() - n * 86400000 - h * 3600000).toISOString()
}

function mondayWeeksAgo(n) {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow - n * 7)
  return d.toISOString().slice(0, 10)
}

const S = {
  ode: 'sess-ode-0001',
  graphs: 'sess-graphs-0002',
  thermo: 'sess-thermo-0003',
  linalg: 'sess-linalg-0004',
  probability: 'sess-prob-0005',
}

export function buildFixture() {
  const weeklyCounts = [0, 1, 0, 3, 2, 0, 0, 4, 1, 5, 2, 3]
  return {
    total_sessions: 9,
    active_sessions: 3,
    ended_sessions: 6,
    total_learning_events: 47,
    last_active_at: daysAgo(0, 2),
    combined_mastered_concepts: [
      { concept: 'separable equations', count: 3, first_seen_session_id: S.ode },
      { concept: 'matrix rank', count: 2, first_seen_session_id: S.linalg },
      { concept: 'breadth-first search', count: 2, first_seen_session_id: S.graphs },
      { concept: 'first law of thermodynamics', count: 1, first_seen_session_id: S.thermo },
      { concept: 'conditional probability', count: 1, first_seen_session_id: S.probability },
      { concept: 'eigenvalues', count: 1, first_seen_session_id: S.linalg },
      { concept: 'Dijkstra', count: 1, first_seen_session_id: S.graphs },
    ],
    combined_confirmed_gaps: [
      { concept: 'integrating factor', count: 2, first_seen_session_id: S.ode },
      { concept: 'entropy', count: 2, first_seen_session_id: S.thermo },
      { concept: 'Bayes theorem', count: 1, first_seen_session_id: S.probability },
      { concept: 'topological sort', count: 1, first_seen_session_id: S.graphs },
      { concept: 'diagonalisation', count: 1, first_seen_session_id: S.linalg },
    ],
    knowledge_level_distribution: { beginner: 2, intermediate: 4, advanced: 1, unknown: 2 },
    recent_topics: [
      {
        id: S.ode,
        topic: 'Ordinary differential equations',
        created_at: daysAgo(1),
        ended_at: null,
        last_session_summary: null,
        message_count: 42,
        last_activity_at: daysAgo(0, 2),
        last_message_preview: 'So the integrating factor is e to the integral of p?',
        progress: {
          focus_target_gap: 'integrating factor',
          level: 'intermediate',
          mastered_count: 4,
        },
      },
      {
        id: S.graphs,
        topic: 'Graph algorithms',
        created_at: daysAgo(3),
        ended_at: null,
        last_session_summary: null,
        message_count: 18,
        last_activity_at: daysAgo(2),
        last_message_preview: 'Why does Dijkstra fail on negative edges?',
        progress: { focus_target_gap: 'topological sort', level: 'advanced', mastered_count: 3 },
      },
      {
        id: S.thermo,
        topic: 'Thermodynamics',
        created_at: daysAgo(6),
        ended_at: daysAgo(4),
        last_session_summary:
          '[auto] Covered the first law and heat engines; entropy remains the open gap.',
        message_count: 31,
        last_activity_at: daysAgo(4),
        last_message_preview: null,
        progress: { focus_target_gap: 'entropy', level: 'beginner', mastered_count: 1 },
      },
      {
        id: S.linalg,
        topic: 'Linear algebra',
        created_at: daysAgo(9),
        ended_at: null,
        last_session_summary: null,
        message_count: 7,
        last_activity_at: daysAgo(9),
        last_message_preview: null,
        progress: { focus_target_gap: null, level: null, mastered_count: 0 },
      },
      {
        id: S.probability,
        topic: 'Probability',
        created_at: daysAgo(14),
        ended_at: daysAgo(12),
        last_session_summary: '[auto] Conditional probability landed; Bayes still needs work.',
        message_count: 24,
        last_activity_at: daysAgo(12),
        last_message_preview: null,
        progress: { focus_target_gap: 'Bayes theorem', level: 'intermediate', mastered_count: 2 },
      },
    ],
    concept_accuracy: [
      {
        concept: 'entropy',
        correct_count: 1,
        total_count: 5,
        accuracy: 0.2,
        last_results: [false, false, true, false, false],
        first_seen_session_id: S.thermo,
      },
      {
        concept: 'integrating factor',
        correct_count: 1,
        total_count: 3,
        accuracy: 0.33,
        last_results: [false, true, false],
        first_seen_session_id: S.ode,
      },
      {
        concept: 'Bayes theorem',
        correct_count: 2,
        total_count: 4,
        accuracy: 0.5,
        last_results: [false, true, false, true],
        first_seen_session_id: S.probability,
      },
      {
        concept: 'topological sort',
        correct_count: 1,
        total_count: 2,
        accuracy: 0.5,
        last_results: [true, false],
        first_seen_session_id: S.graphs,
      },
      {
        concept: 'eigenvalues',
        correct_count: 2,
        total_count: 3,
        accuracy: 0.67,
        last_results: [false, true, true],
        first_seen_session_id: S.linalg,
      },
      {
        concept: 'matrix rank',
        correct_count: 3,
        total_count: 4,
        accuracy: 0.75,
        last_results: [true, false, true, true],
        first_seen_session_id: S.linalg,
      },
      {
        concept: 'breadth-first search',
        correct_count: 4,
        total_count: 5,
        accuracy: 0.8,
        last_results: [true, true, false, true, true],
        first_seen_session_id: S.graphs,
      },
      {
        concept: 'conditional probability',
        correct_count: 1,
        total_count: 1,
        accuracy: 1,
        last_results: [true],
        first_seen_session_id: S.probability,
      },
      {
        concept: 'separable equations',
        correct_count: 5,
        total_count: 5,
        accuracy: 1,
        last_results: [true, true, true, true, true],
        first_seen_session_id: S.ode,
      },
    ],
    weekly_mastery: weeklyCounts.map((count, i) => ({
      week_start: mondayWeeksAgo(11 - i),
      count,
    })),
  }
}

export function buildEmptyFixture() {
  return {
    total_sessions: 0,
    active_sessions: 0,
    ended_sessions: 0,
    total_learning_events: 0,
    last_active_at: null,
    combined_mastered_concepts: [],
    combined_confirmed_gaps: [],
    knowledge_level_distribution: { beginner: 0, intermediate: 0, advanced: 0, unknown: 0 },
    recent_topics: [],
    concept_accuracy: [],
    weekly_mastery: Array.from({ length: 12 }, (_, i) => ({
      week_start: mondayWeeksAgo(11 - i),
      count: 0,
    })),
  }
}
