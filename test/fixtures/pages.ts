/**
 * Minimal hand-written pages that mirror the structure of the real sites
 * (not copies of them). Update when a site's markup changes.
 */

export const WWMOD_DOWNLOAD = `<!doctype html><html><body>
<div style="display:flex"><div>
  <h2>WickedWhims v185k</h2>
  <h3>May 23rd, 2026</h3>
  <p><strong>Supported Game Versions:</strong></p>
  <p> 1.127.41/<font>August 25</font> </p>
  <p> 1.126.78/<font>August 6</font>, 1.125.59/<font>June 30</font>,<br> 1.124.63/<font>May 21</font></p>
  <p><a href="#">Update Patch Notes</a></p>
  <p>Version 9.9.9 mentioned later must not count</p>
</div></div>
<p>Download from... <a href="https://wicked.cc/mods/admin/wickedwhims/">WICKED.CC</a> or <a href="https://turbodriver.itch.io/wickedwhims">ITCH.IO</a></p>
<p><h1>Honorary Animators (Compatible)</h1><hr/></p>
<div class="download-boxes">
  <div class="download-box">
    <div class="download-box-title"> Moonberry </div>
    <div class="download-box-links">
      <a href="https://wicked.cc/animations/moonberry/sex-animations/"><img src="wcc.png"></a><a href="https://www.loverslab.com/files/file/3528-moonberry-animations/"><img src="ll.png"></a>
    </div>
  </div>
</div>
<p><h1>Inactive Animators (Compatible)</h1><hr/></p>
<div class="download-boxes">
  <div class="download-box download-box-small">
    <div class="download-box-title download-box-title-small"> <b>Willow Bank</b> </div>
    <div class="download-box-links download-box-links-small"><a href="https://www.loverslab.com/files/file/8755-willows-animations/"><img src="ll.png"></a></div>
  </div>
</div>
<p><h1>Devices &amp; Accessories (Optional)</h1><hr/></p>
<div class="download-boxes">
  <div class="download-box download-box-big">
    <div class="download-box-title"> Bondage Devices </div>
    <div class="download-box-text download-box-text-big"> Moonberry </div>
    <div class="download-box-links"><a href="https://www.loverslab.com/files/file/3527-bondage-devices/"><img src="ll.png"></a><a href="https://example.com/site"><img src="web.png"></a></div>
  </div>
</div>
</body></html>`;

export const WICKEDCC_PACK = `<!doctype html><html><head>
<meta property="og:title" content="Tester&#039;s Animations - WickedCC" />
<meta property="article:modified_time" content="2026-08-28T12:04:47+00:00" />
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Tester's Animations","datePublished":"2024-01-26T00:00:00+00:00","dateModified":"2026-08-28T12:04:47+00:00","author":{"@type":"Person","name":"Tester"}}]}</script>
</head><body>
<p>Updated: 2026-08-28</p>
<a href="https://wicked.cc/animations/tester/testers-animations/download/AbC123" class="download-btn">Download</a>
<a href="https://www.patreon.com/tester">Patreon</a>
<a href="https://www.patreon.com/posts/some-post-123">A post</a>
<a href="https://www.loverslab.com/files/file/1-someone-elses-objects/">Required objects</a>
</body></html>`;

export const WICKEDCC_CREATOR_INDEX = `<!doctype html><html><body>
<a href="https://wicked.cc/animations/tester/testers-animations">Tester's Animations</a>
<a href="https://wicked.cc/animations/tester/testers-animations/download/AbC123">Download</a>
<a href="https://wicked.cc/animations/all?sort=updated">All</a>
</body></html>`;

export const WICKEDCC_REDIRECT = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
<meta http-equiv="refresh" content="0;url='https://wicked.cc/mods/TURBODRIVER/wickedwhims'" />
</head><body>Redirecting</body></html>`;

export const LOVERSLAB_FILE = `<!doctype html><html><head>
<meta property="og:title" content="Tester Adult Animations" />
<script type="application/ld+json">{"@context":"http://schema.org","@type":"WebApplication","name":"Tester Adult Animations","softwareVersion":"2.6","dateModified":"2024-04-10T21:52:40+0000","author":{"@type":"Person","name":"Tester"}}</script>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"WebSite","name":"LoversLab"}</script>
</head><body>
<a href="https://www.patreon.com/Tester">My Patreon</a>
<a href="https://www.patreon.com/join/Tester?u=1">Join</a>
</body></html>`;

export const CHALLENGE = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>`;

/** The interstitial Cloudflare serves under the site's own title, so only its markup gives it away. */
export const CHALLENGE_UNTITLED = `<!DOCTYPE html><html lang="en-US"><head><title>www.patreon.com</title></head><body class="no-js">
<div id="cf-wrapper"><div id="challenge-form" class="challenge-form"><div id="cf-please-wait"></div></div></div>
<script>window._cf_chl_opt={cvId:'3',cType:'managed',cRay:'a3c3ec2ecb696417'};</script></body></html>`;

/** Cloudflare adds its detection script to ordinary pages too; that alone is not a challenge. */
export const PATREON_WITH_CF_SCRIPT = `<!doctype html><html><head><title>PINEGLEN | Patreon</title></head><body>
<script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/main.js"></script><h1>Posts</h1></body></html>`;

export const PATREON_PAGE = `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"bootstrapEnvelope":{"pageBootstrap":{"campaign":{"data":{"id":"10577235","type":"campaign"}}}}}}}</script></body></html>`;

export const PATREON_POSTS = JSON.stringify({
  data: [
    { id: '3', type: 'post', attributes: { title: 'Poll: what next?', published_at: '2026-09-10T10:00:00.000+00:00', current_user_can_view: true, url: 'https://www.patreon.com/posts/poll-3' } },
    { id: '2', type: 'post', attributes: { title: 'August Animations [Turn Me On]', published_at: '2026-09-05T15:58:19.000+00:00', current_user_can_view: false, url: 'https://www.patreon.com/posts/august-2' } },
    { id: '1', type: 'post', attributes: { title: 'July Animations', published_at: '2026-08-06T00:16:41.000+00:00', current_user_can_view: false } },
  ],
  links: {},
});

export const LOVERSLAB_CHOOSER = `<!doctype html><html><body>
<div class="ipsBox"><ul class="ipsDataList">
  <li class="ipsDataItem">
    <div class="ipsDataItem_main"><h4 class="ipsDataItem_title">WW_0rchid_SpecialGift_Animations.package</h4><p class="ipsType_light">4.2 MB</p></div>
    <div class="ipsDataItem_generic"><a href="https://www.loverslab.com/files/file/29320-0rchid/?do=download&amp;r=1001&amp;confirm=1&amp;t=1&amp;csrfKey=abc" class="ipsButton">Download</a></div>
  </li>
  <li class="ipsDataItem">
    <div class="ipsDataItem_main"><h4 class="ipsDataItem_title">WW_0rchid_Animations.package</h4><p class="ipsType_light">29.5 MB</p></div>
    <div class="ipsDataItem_generic"><a href="https://www.loverslab.com/files/file/29320-0rchid/?do=download&amp;r=1002&amp;confirm=1&amp;t=1&amp;csrfKey=abc" class="ipsButton">Download</a></div>
  </li>
  <li class="ipsDataItem">
    <div class="ipsDataItem_main"><h4 class="ipsDataItem_title">preview.jpg</h4></div>
    <div class="ipsDataItem_generic"><a href="/files/file/29320-0rchid/?do=download&amp;r=1003&amp;confirm=1&amp;t=1&amp;csrfKey=abc" class="ipsButton">Download</a></div>
  </li>
</ul></div>
</body></html>`;
