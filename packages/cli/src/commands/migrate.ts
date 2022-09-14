import fs from 'fs';
import path from 'path';
import { LevelUp } from 'levelup';
import { logger } from '@rei-network/utils';
import { createEncodingLevelDB, createEncodingRocksDB, createLevelDB, createRocksDB, batchMigrate } from '@rei-network/database';

export async function installMigrateCommand(program: any) {
  program
    .command('migrate')
    .description('Migrate data from leveldb to rocksdb')
    .action(async () => {
      const { datadir } = program.opts();
      let dbs: [LevelUp, LevelUp][] = [];
      if (!fs.existsSync(path.join(datadir, 'chaindb')) || !fs.existsSync(path.join(datadir, 'nodes')) || !fs.existsSync(path.join(datadir, 'evidence'))) {
        throw new Error('Database is not exist');
      }
      try {
        dbs = [
          [createEncodingLevelDB(path.join(datadir, 'chaindb')), createEncodingRocksDB(path.join(datadir, 'chaindb-rocks'))],
          [createLevelDB(path.join(datadir, 'nodes')), createRocksDB(path.join(datadir, 'nodes-rocks'))],
          [createLevelDB(path.join(datadir, 'evidence')), createRocksDB(path.join(datadir, 'evidence-rocks'))]
        ];
        logger.info('Migrate leveldb to rocksdb start');
        await batchMigrate(dbs);
        await closeDb(dbs);
        logger.info('Migrate leveldb to rocksdb done');
      } catch (err) {
        logger.error('Migrate error:', err);
        await closeDb(dbs);
        process.exit(1);
      }
    });
}

async function closeDb(dbs: [LevelUp, LevelUp][]) {
  const task: Promise<void>[] = [];
  dbs.map((db) => {
    db.map((d) => task.push(d.close()));
  });
  await Promise.all(task);
}
