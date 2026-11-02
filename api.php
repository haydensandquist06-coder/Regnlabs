<?php
/*
 * REGN Labs store API
 * Saves admin changes instantly and serves the live catalog to the storefront.
 * Upload this file next to index.html. Requires PHP 7.4 or newer.
 *
 * Data is kept in regn-data/ (created automatically). Uploaded images and COAs go in uploads/.
 * You can change the admin password from the admin panel (Settings tab).
 */
declare(strict_types=1);

const DEFAULT_PASSWORD_HASH = '$2y$10$YIUYVbiUIeD2A5LQJI90JOiq8NVdQkba5u/2o.KuFaFUGtXHXvW2S';
const DATA_DIR   = __DIR__ . '/regn-data';
const UPLOAD_DIR = __DIR__ . '/uploads';
const GUARD      = "<?php exit; ?>\n";   // stops data files from being read over the web
const SESSION_HOURS = 8;
const MAX_LOGIN_ATTEMPTS = 8;           // per IP address per 15 minutes

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

function out($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $msg, int $code = 400): void { out(['error' => $msg], $code); }

// ---------- storage ----------
function ensure_dirs(): void {
    foreach ([DATA_DIR, UPLOAD_DIR, UPLOAD_DIR . '/images', UPLOAD_DIR . '/coa'] as $d) {
        if (!is_dir($d) && !@mkdir($d, 0755, true)) {
            fail('The server could not create the ' . basename($d) . ' folder. Make the site folder writable by PHP.', 500);
        }
        if (!file_exists("$d/index.html")) @file_put_contents("$d/index.html", '');
    }
    $deny = "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n";
    if (!file_exists(DATA_DIR . '/.htaccess')) @file_put_contents(DATA_DIR . '/.htaccess', $deny);
    $noScripts = "<FilesMatch \"\\.(php[0-9]?|phtml|phar|pl|py|cgi|sh|html?|svg)$\">\n$deny</FilesMatch>\n";
    if (!file_exists(UPLOAD_DIR . '/.htaccess')) @file_put_contents(UPLOAD_DIR . '/.htaccess', $noScripts);
}
function data_file(string $name): string { return DATA_DIR . "/$name.php"; }
function read_data(string $name, $default) {
    $f = data_file($name);
    if (!is_file($f)) return $default;
    $raw = file_get_contents($f);
    if ($raw === false) return $default;
    if (strpos($raw, GUARD) === 0) $raw = substr($raw, strlen(GUARD));
    $v = json_decode($raw, true);
    return $v === null ? $default : $v;
}
function write_data(string $name, $value): void {
    $json = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) fail('The data could not be encoded.', 500);
    $tmp = DATA_DIR . '/tmp-' . bin2hex(random_bytes(6)) . '.php';
    if (file_put_contents($tmp, GUARD . $json, LOCK_EX) === false) {
        fail('The server could not write to the regn-data folder. Make it writable by PHP.', 500);
    }
    if (!@rename($tmp, data_file($name))) { @unlink($tmp); fail('The server could not save the data.', 500); }
}
function store_version(): string {
    $f = data_file('store');
    return is_file($f) ? sha1_file($f) : '';
}

// ---------- input cleaning ----------
function s($v, int $max = 5000): string { return mb_substr(trim(is_scalar($v) ? (string)$v : ''), 0, $max); }
function safe_url($v, bool $allowPdf = false): ?string {
    $v = is_string($v) ? trim($v) : '';
    if ($v === '') return null;
    if (preg_match('#^uploads/(images|coa)/[A-Za-z0-9._-]+$#', $v)) return $v;
    if (preg_match('#^https?://#i', $v) && strlen($v) < 2000) return $v;
    if (preg_match('#^data:image/(png|jpe?g|webp|gif);base64,#i', $v)) return $v;
    if ($allowPdf && preg_match('#^data:application/pdf;base64,#i', $v)) return $v;
    return null;
}
function clean_store(array $d): array {
    $site = is_array($d['site'] ?? null) ? $d['site'] : [];
    $cs = [];
    foreach (['announcement' => 200, 'heroEyebrow' => 80, 'heroTitle' => 160, 'heroText' => 400, 'about' => 6000,
              'contactEmail' => 200, 'businessAddress' => 300, 'shippingPolicy' => 6000, 'returnPolicy' => 6000, 'brand' => 80] as $k => $max) {
        $cs[$k] = s($site[$k] ?? '', $max);
    }
    $cs['categories'] = array_slice(array_values(array_filter(array_map(fn($c) => s($c, 60), (array)($site['categories'] ?? [])))), 0, 30);
    $cs['faq'] = [];
    foreach (array_slice((array)($site['faq'] ?? []), 0, 60) as $f) {
        if (is_array($f) && s($f['q'] ?? '') !== '') $cs['faq'][] = ['q' => s($f['q'], 300), 'a' => s($f['a'] ?? '', 2000)];
    }
    $products = [];
    $seen = [];
    foreach (array_slice((array)($d['products'] ?? []), 0, 3000) as $p) {
        if (!is_array($p)) continue;
        $sku = strtoupper(preg_replace('/[^A-Za-z0-9_-]/', '', s($p['sku'] ?? '', 40)));
        if ($sku === '' || isset($seen[$sku])) continue;
        $seen[$sku] = true;
        $specs = [];
        foreach (array_slice((array)($p['specs'] ?? []), 0, 30) as $sp) {
            if (is_array($sp) && s($sp['k'] ?? '') !== '') $specs[] = ['k' => s($sp['k'], 80), 'v' => s($sp['v'] ?? '', 200)];
        }
        $images = [];
        foreach (array_slice((array)($p['images'] ?? []), 0, 12) as $u) { $u = safe_url($u); if ($u) $images[] = $u; }
        $products[] = [
            'id' => preg_replace('/[^A-Za-z0-9-]/', '', s($p['id'] ?? '', 64)) ?: bin2hex(random_bytes(8)),
            'sku' => $sku,
            'name' => s($p['name'] ?? '', 200),
            'price' => max(0, round((float)($p['price'] ?? 0), 2)),
            'stock' => max(0, (int)($p['stock'] ?? 0)),
            'category' => s($p['category'] ?? '', 80),
            'size' => s($p['size'] ?? '', 80),
            'purity' => s($p['purity'] ?? '', 40),
            'form' => s($p['form'] ?? '', 80),
            'cas' => s($p['cas'] ?? '', 40),
            'status' => ($p['status'] ?? '') === 'active' ? 'active' : 'draft',
            'featured' => !empty($p['featured']),
            'short' => s($p['short'] ?? '', 400),
            'description' => s($p['description'] ?? '', 8000),
            'specs' => $specs,
            'images' => $images,
            'coa' => safe_url($p['coa'] ?? null, true),
            'createdAt' => s($p['createdAt'] ?? '', 40),
            'updatedAt' => s($p['updatedAt'] ?? '', 40),
        ];
    }
    return ['site' => $cs, 'products' => $products];
}

// ---------- session & auth ----------
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('regn_admin');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'secure' => $https, 'samesite' => 'Strict']);

function password_hash_current(): string {
    $auth = read_data('auth', []);
    return is_string($auth['hash'] ?? null) ? $auth['hash'] : DEFAULT_PASSWORD_HASH;
}
function is_admin(): bool {
    if (empty($_SESSION['admin'])) return false;
    if (time() - (int)($_SESSION['seen'] ?? 0) > SESSION_HOURS * 3600) { $_SESSION = []; return false; }
    $_SESSION['seen'] = time();
    return true;
}
function require_post(): void { if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Use POST for this action.', 405); }
function require_admin(): void {
    if (!is_admin()) fail('Not signed in.', 401);
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($token) || !hash_equals((string)($_SESSION['csrf'] ?? ''), $token)) fail('Your session expired. Sign in again.', 401);
}
function client_key(): string { return hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown')); }
function recent_failures(array $all): array {
    $now = time();
    foreach ($all as $k => $times) {
        $all[$k] = array_values(array_filter((array)$times, fn($t) => (int)$t > $now - 900));
        if (!$all[$k]) unset($all[$k]);
    }
    return $all;
}
function json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw !== false && strlen($raw) > 25 * 1024 * 1024) fail('That request is too large.', 413);
    $j = json_decode($raw ?: 'null', true);
    return is_array($j) ? $j : [];
}

// ---------- uploads ----------
function detect_type(string $path): ?string {
    if (class_exists('finfo')) {
        $m = (new finfo(FILEINFO_MIME_TYPE))->file($path);
        if (is_string($m)) return $m;
    }
    $head = (string)@file_get_contents($path, false, null, 0, 16);
    if (strpos($head, '%PDF') === 0) return 'application/pdf';
    $info = @getimagesize($path);
    return $info['mime'] ?? null;
}
function upload_error(int $code): string {
    switch ($code) {
        case UPLOAD_ERR_INI_SIZE:
        case UPLOAD_ERR_FORM_SIZE: return 'That file is larger than your host allows. Raise upload_max_filesize in your hosting PHP settings, or use a smaller file.';
        case UPLOAD_ERR_PARTIAL: return 'The upload was interrupted. Try again.';
        case UPLOAD_ERR_NO_FILE: return 'Choose a file to upload.';
        default: return 'The server could not accept that upload.';
    }
}

// ---------- routes ----------
$action = (string)($_GET['a'] ?? '');

if ($action === 'public') {
    // Live catalog for the storefront: live products only, no session needed.
    $d = read_data('store', null);
    if (!is_array($d)) out(['empty' => true]);
    $live = array_values(array_filter($d['products'] ?? [], fn($p) => ($p['status'] ?? '') === 'active'));
    header('Cache-Control: no-cache, must-revalidate');
    out(['site' => $d['site'] ?? [], 'products' => $live, 'version' => store_version()]);
}

ensure_dirs();
session_start();

switch ($action) {
    case 'me':
        $ok = is_admin();
        out(['admin' => $ok, 'csrf' => $ok ? (string)($_SESSION['csrf'] ?? '') : '']);

    case 'login':
        require_post();
        $fails = recent_failures(read_data('attempts', []));
        $key = client_key();
        if (count($fails[$key] ?? []) >= MAX_LOGIN_ATTEMPTS) fail('Too many attempts. Try again in 15 minutes.', 429);
        $pw = (string)(json_body()['password'] ?? '');
        if (!password_verify($pw, password_hash_current())) {
            $fails[$key][] = time();
            write_data('attempts', $fails);
            usleep(400000);
            fail('Incorrect password.', 401);
        }
        unset($fails[$key]);
        write_data('attempts', $fails);
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        $_SESSION['seen'] = time();
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        out(['ok' => true, 'csrf' => $_SESSION['csrf']]);

    case 'logout':
        require_post();
        $_SESSION = [];
        session_destroy();
        out(['ok' => true]);

    case 'all':
        require_admin();
        out(['data' => read_data('store', null), 'version' => store_version()]);

    case 'save':
        require_post();
        require_admin();
        $b = json_body();
        if (!is_array($b['data'] ?? null) || !is_array($b['data']['products'] ?? null)) fail('That is not valid store data.');
        $lock = fopen(DATA_DIR . '/save.lock', 'c');
        flock($lock, LOCK_EX);
        if ((string)($b['version'] ?? '') !== store_version()) {
            flock($lock, LOCK_UN);
            fail('The store was changed somewhere else (another tab or device). Reload to get the latest version.', 409);
        }
        write_data('store', clean_store($b['data']));
        $v = store_version();
        flock($lock, LOCK_UN);
        out(['ok' => true, 'version' => $v, 'savedAt' => date('c')]);

    case 'upload':
        require_post();
        require_admin();
        $kind = ($_POST['kind'] ?? '') === 'coa' ? 'coa' : 'images';
        $f = $_FILES['file'] ?? null;
        if (!$f || !is_array($f) || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            if (empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) fail(upload_error(UPLOAD_ERR_INI_SIZE), 413);
            fail(upload_error((int)($f['error'] ?? UPLOAD_ERR_NO_FILE)));
        }
        $max = $kind === 'coa' ? 15 : 10;
        if ($f['size'] > $max * 1024 * 1024) fail("Files must be under $max MB.");
        $types = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
        if ($kind === 'coa') $types['application/pdf'] = 'pdf';
        $type = detect_type($f['tmp_name']);
        if (!$type || !isset($types[$type])) fail($kind === 'coa' ? 'COAs must be a PDF or an image.' : 'Images must be JPG, PNG, WebP or GIF.');
        $name = date('Ymd') . '-' . bin2hex(random_bytes(8)) . '.' . $types[$type];
        if (!move_uploaded_file($f['tmp_name'], UPLOAD_DIR . "/$kind/$name")) fail('The server could not store the file. Make the uploads folder writable.', 500);
        @chmod(UPLOAD_DIR . "/$kind/$name", 0644);
        out(['url' => "uploads/$kind/$name"]);

    case 'password':
        require_post();
        require_admin();
        $b = json_body();
        if (!password_verify((string)($b['current'] ?? ''), password_hash_current())) fail('Your current password is incorrect.');
        $new = (string)($b['new'] ?? '');
        if (strlen($new) < 12) fail('Use at least 12 characters for the new password.');
        write_data('auth', ['hash' => password_hash($new, PASSWORD_DEFAULT)]);
        out(['ok' => true]);

    default:
        fail('Unknown action.', 404);
}
