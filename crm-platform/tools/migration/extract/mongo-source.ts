import type { Doc } from '../util';
import type { Source } from './source';

/**
 * MongoSource: reads straight from a live MongoDB.
 *
 * NOT IMPLEMENTED on purpose. The official `mongodb` driver is not a dependency of this repo, and phase 1 does not touch Mongo
 * (dumps are produced separately as NDJSON). To implement: add `mongodb` as a devDependency of this tool, then
 *   clients()     -> the configured database names
 *   collections() -> db.listCollections().toArray()
 *   read()        -> db.collection(c).find({}).sort({ _id: 1 }) with EJSON.serialize(doc, { relaxed: false }) round-tripped through
 *                    parseEjsonLine, so both sources hand the loader identical shapes.
 * Prefer dumping to NDJSON and loading from the dump: the dump is also the archive the README requires before cutover.
 */
export class MongoSource implements Source {
  constructor(readonly uri: string) {
    throw new Error(
      'MongoSource is a documented stub: dump to NDJSON (see tools/migration/README.md) and use NdjsonDirSource',
    );
  }
  clients(): string[] {
    return [];
  }
  collections(): string[] {
    return [];
  }
  badLines(): never[] {
    return [];
  }
  fileOf(): string | null {
    return null;
  }
  // eslint-disable-next-line require-yield
  async *read(): AsyncIterable<Doc> {
    throw new Error('not implemented');
  }
}
