export type PostgresConfig =
  | { connectionString: string }
  | {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
    };

export function resolvePostgresConfig(env: NodeJS.ProcessEnv): PostgresConfig {
  const connectionString = env.DATABASE_URL?.trim();
  if (connectionString) {
    return { connectionString };
  }

  const host = env.PGHOST?.trim();
  const port = env.PGPORT?.trim();
  const database = env.PGDATABASE?.trim();
  const user = env.PGUSER?.trim();
  const password = env.PGPASSWORD;
  const missing = [
    !host && 'PGHOST',
    !port && 'PGPORT',
    !database && 'PGDATABASE',
    !user && 'PGUSER',
    !password && 'PGPASSWORD',
  ].filter((key): key is string => Boolean(key));

  if (missing.length > 0) {
    throw new Error(`Missing required PostgreSQL configuration: ${missing.join(', ')}`);
  }

  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error('PGPORT must be an integer between 1 and 65535');
  }

  return {
    host: host!,
    port: parsedPort,
    database: database!,
    user: user!,
    password: password!,
  };
}
