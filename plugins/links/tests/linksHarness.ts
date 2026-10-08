// The Links plugin's core over a test archive: its tables adopted as core init does, and its feed.
import { archivePayloads } from '@core/plugins/archivePayloads';
import type { Db } from '@core/db';
import { storeLinkText } from '@core/derivedText';
import { storeLinkImages, type LinkImage } from '@core/messageImages';
import { adoptBundledData } from '@core/plugins/adoption';
import { messagesByIds } from '@core/queries/messages';
import { linkPage, linkWindow, personLinkPage } from '../core/feed';
import { plugin } from '../shared';
import type { LinkCard, LinkItem, LinkPageQuery, LinkWindow, LinkWindowQuery, PersonLinksQuery } from '../shared/types';

/** Renames the host's link tables into the plugin's, as core init does before plugins start. */
export function adoptLinks(db: Db): Db {
  adoptBundledData(db, [plugin]);
  return db;
}

/** A page of the Links feed, with the sharing messages as the Archive shows them. */
export const linkFeed = (db: Db, q: LinkPageQuery): LinkItem[] => linkPage(db, (ids) => archivePayloads(db, ids), (ids) => messagesByIds(db, ids), q);

/** The Links feed around a cursor. */
export const linkFeedWindow = (db: Db, q: LinkWindowQuery): LinkWindow => linkWindow(db, (ids) => archivePayloads(db, ids), (ids) => messagesByIds(db, ids), q);

/** A person's links, each at their latest share of it. */
export const personLinks = (db: Db, q: PersonLinksQuery): LinkCard[] => personLinkPage(db, (ids) => archivePayloads(db, ids), q);

/** The host's link stores for the Links plugin: its text (core wiring judges again the messages it returns) and images. */
export const hostLinks = (db: Db, onText: (messageIds: string[]) => void = () => undefined) => ({
  linkText: { set: hostLinkText(db, onText) },
  linkImages: { set: (url: string, images: readonly LinkImage[], record?: () => void): void => void storeLinkImages(db, url, plugin.manifest.id, images, record) },
});

/** The host's linkText.set for the Links plugin (core wiring also judges again the messages it returns). */
export const hostLinkText =
  (db: Db, onText: (messageIds: string[]) => void = () => undefined) =>
  (url: string, text: string, record?: () => void): void =>
    onText(storeLinkText(db, url, plugin.manifest.id, text, record));
