/**
 * The one address a person writes to when something is wrong.
 *
 * Used by the public legal pages (where a privacy request or an Intuit reviewer
 * lands) and by the in-app support line on the QuickBooks screen. It lives here
 * rather than in either of them because two copies of a contact address drift:
 * one gets updated, the other keeps pointing at a mailbox nobody reads, and the
 * failure is invisible until someone's message goes unanswered.
 *
 * Changing it here changes it everywhere. A test asserts there is no second
 * copy anywhere else.
 */
export const SUPPORT_EMAIL = 'tyler.torrie@tntpollination.com'
