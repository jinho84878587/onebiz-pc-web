# Document center API — feature version 1

All owner endpoints use the existing ONEBIZ session and write guards. No `userId`
from a request is accepted. Every response is private, `Cache-Control: no-store`.
Time fields are epoch milliseconds or `null`; business snapshot revisions do not
change when delivery, opening, signing, notification reads or settings change.

## Owner endpoints

- `GET /api/document-center?limit=50` (1–100): `{ok,userId,documents,notifications,unreadCount,settings,capabilities,hasMore,hasMoreNotifications,refreshedAt}`.
- `GET /api/document-center/documents/:id`: `{ok,userId,document}`. Same document
  shape as the list; other owners' IDs return 404.
- `POST /api/document-center/refresh {}`: same list payload plus
  `refresh:{checked,pending}`. Only reads provider delivery/signing results; never
  sends a message. At most 6 delivery and 2 signing targets, shared concurrency 3.
  Rate limited, coalesced and subject to per-document backoff. Client timeout 65s.
- `POST /api/document-center/notifications/read {ids:[...]}` (max 100), or
  `{all:true}`: `{ok,unreadCount}`. Read updates always include the owner predicate.
- `PUT /api/document-center/settings`: partial booleans from
  `{firstOpen:true,signatureComplete:true,deliveryFailure:true,deliveryComplete:false,mobileNotifications:false}`.
  Returns `{ok,settings}`. History stays available when mobile alerts are disabled.

Document: `{id,versionId,kind,variant,sourceId,sourceType,title,customer,phoneMask,
amount,sentAt,createdAt,lastEventAt,deliveryStatus,deliveryLabel,deliveredAt,failedAt,
failureReason,providerCheckNotice,deliveryCheckAvailable,firstOpenedAt,lastOpenedAt,
openCount,signLinkOpenedAt,signLinkOpenCount,originalLinkOpenedAt,
originalLinkOpenCount,signedAt,canRetry:false,previewUrl,immutableOriginal,legacy,
metadataNotice,events:[{type,at,message}]}`.

`kind`: `quote | contract | statement | receipt`; `variant`:
`document | sign_request | completed`; `sourceType`: `quote | contract`.
Each ID is a particular issued/sent version, not a mutable source document ID.
Names and amounts are captured and encrypted at creation; legacy records cannot
reconstruct historic names/amounts and are clearly labelled.

`deliveryStatus`:

| Value | Label |
| --- | --- |
| pending | 발송 처리 중 |
| accepted | 발송 접수 |
| unknown | 결과 미확인 |
| delivered | 전달 성공 |
| failed | 발송 실패 |
| unavailable | 전달 확인 불가 |
| not_sent | 링크 발행 |

Only provider `status=COMPLETE` plus `statusCode=4000` is delivery success.
Delivery is independent from link opens and signatures. Provider IDs are stored
but not returned to public pages. Owner preview URLs contain an opaque preview
proof; do not share them as customer URLs.

Notifications: `{id,documentId,kind,title,body,createdAt,readAt}`; kinds are
`opened | original_link_opened | signed | failed | delivered`. Unread records are
listed first, then newest first. `unreadCount` counts all owner unread records.
`firstOpen` maps to opened/original_link_opened, `signatureComplete` to signed,
`deliveryFailure` to failed, `deliveryComplete` to delivered. Mobile clients apply
these settings plus `mobileNotifications` to OS notifications. No real-time push
or owner Alimtalk is implemented: capabilities always have
`instantPush:false,ownerAlimtalk:false`.

## Public explicit-open flow

Public document GET/HEAD and JSON GET do not record an open. A link alone does not
identify a person or establish that content was read. `/s/:token` shows a landing
page instead of automatically redirecting.

1. `POST /api/public/document-access/:kind/:token/challenge` with
   `{previewToken?: string}`. `kind=quote|contract|statement|receipt|sign` (`sign`
   for `/s`). Same-origin JSON request; retain HTTP-only visitor cookie. Returns
   `{ok,challenge,expiresAt,mode,tracked,title}`. `mode` is `customer`,
   `owner_preview`, or `automated`; noncustomer challenges are null.
2. On an explicit open action, local pages load/render their existing public JSON
   then POST `/api/public/document-access/:kind/:token/open`
   `{challenge,previewToken?}`. For external signing/original links, POST before
   navigating and use returned `redirectUrl`. No synthetic `.click()` should
   count as a user action.
3. Response: `{ok,recorded,reason,firstOpenedAt?,lastOpenedAt?,openCount?,
   signLinkOpenedAt?,originalLinkOpenedAt?,redirectUrl?}`.

Read `previewToken` from the `preview` query parameter. An authenticated owner or
a valid server-issued preview proof gets `owner_preview`: viewing is allowed but
never counted. Automated previews are not counted. Challenges expire after five
minutes, are single use and browser-bound; repeat opens in the same browser and
version within 30 minutes are deduplicated. A new first-open notification is
unique per version. Historical `last_view` values are never promoted to new opens.

`sign` only records `sign_link_opened` / “서명 페이지 이동”, not firstOpenedAt or a
first-open notification. An external completed-original redirect only records
`original_link_opened` / “원본 링크 열림”, independently of firstOpenedAt. Stored
document content records `opened` after explicit rendering.

Event types: `created,accepted,unknown,failed,delivered,opened,signed,
sign_link_opened,original_link_opened,legacy`. Repeated opens update counters and
last times; first-event timeline/notification entries are idempotent.

## Provider and worker limits

Provider read API: `GET /messages/v4/groups/:groupId/messages?limit=100`.
Official schema: <https://solapi.com/developers/api/msg-groups-getGroupMessageList>.
Message identity must match the stored message ID or a unique recipient hash in
the known group. No arbitrary IDs supplied by clients can be queried.
Worker runs once per minute in production only; no overlapping runs. Delivery
backoff is 30 seconds up to one hour, with a seven-day horizon. Signing backoff is
one minute up to one hour, for tracked sign requests up to 30 days. Signing only
reads provider status and archives verified completed originals. It does not
modify business snapshots. Demo/test automatic workers are off.
