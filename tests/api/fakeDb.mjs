// A stand-in for the Supabase server client, backed by the local test database (supabase/tests/run.sh
// makes it): rpc() calls the real SQL function as service_role through psql, and from() covers the few
// simple selects the server functions make. So the API code and the SQL are tested together.
import { execFileSync } from 'node:child_process';

// Postgres array arguments (text[], bigint[]) by name; any other array or object is JSON (as PostgREST does).
const PG_ARRAYS = new Set(['kinds', 'ids']);
const lit = (v, key = '') => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && PG_ARRAYS.has(key)) return `'${JSON.stringify(v).replace(/'/g, "''").replace(/^\[/, '{').replace(/\]$/, '}')}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

export function sql(query, role = 'service_role') {
  try {
    const out = execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', 'dh_test', '-c', `set role ${role}`, '-c', query], {
      env: { ...process.env, PGHOST: process.env.PGHOST ?? '/var/tmp/pg', PGPORT: process.env.PGPORT ?? '5433', PGUSER: process.env.PGUSER ?? 'postgres' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString().trim();
    const last = out.split('\n').pop() ?? '';
    return { data: last === '' ? null : JSON.parse(last), error: null };
  } catch (e) {
    const msg = String(e.stderr ?? e.message);
    const m = msg.match(/ERROR:\s+([0-9A-Z]{5}):\s+(.*)/);
    return { data: null, error: { code: m?.[1] ?? 'XX000', message: m?.[2] ?? msg } };
  }
}

export function fakeDb({ users = {} } = {}) {
  return {
    rpc: async (fn, args = {}) => {
      const named = Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} => ${lit(v, k)}`).join(', ');
      const r = sql(`select coalesce(to_jsonb(x), 'null'::jsonb) from public.${fn}(${named}) x`);
      if (r.error) return r;
      return { data: r.data, error: null };
    },
    from: (table) => {
      const q = { table, cols: '*', where: [], order: null, limit: null };
      const run = (single) => {
        const where = q.where.length ? `where ${q.where.join(' and ')}` : '';
        const order = q.order ? `order by ${q.order}` : '';
        const limit = q.limit !== null ? `limit ${q.limit}` : '';
        const r = sql(`select coalesce(jsonb_agg(to_jsonb(t)), '[]') from (select ${q.cols} from public.${q.table} ${where} ${order} ${limit}) t`);
        if (r.error) return r;
        return { data: single ? (r.data[0] ?? null) : r.data, error: null };
      };
      const b = {
        select: (cols) => ((q.cols = cols.split(',').map((c) => c.trim()).join(', ')), b),
        eq: (c, v) => (q.where.push(`${c} = ${lit(v)}`), b),
        order: (c, o) => ((q.order = `${c} ${o?.ascending === false ? 'desc' : 'asc'}`), b),
        limit: (n) => ((q.limit = n), b),
        maybeSingle: async () => run(true),
        then: (ok, fail) => Promise.resolve(run(false)).then(ok, fail),
      };
      return b;
    },
    auth: {
      getUser: async (token) => (users[token] ? { data: { user: users[token] }, error: null } : { data: { user: null }, error: { message: 'bad token' } }),
    },
  };
}
