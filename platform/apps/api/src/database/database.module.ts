import { Global, Module, type Provider } from '@nestjs/common';
import { createDatabase } from '@preneura/database';

export const DATABASE = Symbol('DATABASE');

const databaseProvider: Provider = {
  provide: DATABASE,
  useFactory: () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }
    return createDatabase(connectionString);
  },
};

@Global()
@Module({
  providers: [databaseProvider],
  exports: [DATABASE],
})
export class DatabaseModule {}
