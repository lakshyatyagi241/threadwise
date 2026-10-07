import { Injectable, type PipeTransform } from '@nestjs/common';
import { notFound } from './messaging-errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path id that is not a uuid cannot name anything here: the same 404 as an id that is not found (WaDesk's routes took digits only and 404ed otherwise). */
@Injectable()
export class UuidParam implements PipeTransform<string, string> {
  constructor(private readonly what: 'Message' | 'Conversation' | 'Device') {}

  transform(value: string): string {
    if (!UUID.test(value)) throw notFound(this.what);
    return value.toLowerCase();
  }
}
