<?php
/**
 * Kargom.co.uk connector for OpenCart 2.x, 3.x and 4.x
 *
 * Put this file in your OpenCart folder, next to config.php (the same folder as index.php).
 * It lets Kargom read orders that are ready to ship and add the tracking number to an order.
 * It only answers requests that carry your private Kargom key, and it never changes anything else.
 * To disconnect, delete this file (or disconnect in your Kargom account).
 */

define('KARGOM_KEY', '__KARGOM_KEY__');
define('KARGOM_CONNECTOR_VERSION', '1.0');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

function kargom_out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$given = '';
if (isset($_SERVER['HTTP_X_KARGOM_KEY'])) $given = (string)$_SERVER['HTTP_X_KARGOM_KEY'];
$raw = file_get_contents('php://input');
$body = $raw ? json_decode($raw, true) : array();
if (!is_array($body)) $body = array();
if ($given === '' && isset($body['key'])) $given = (string)$body['key'];
if (strlen(KARGOM_KEY) < 32 || !hash_equals(KARGOM_KEY, $given)) kargom_out(array('error' => 'unauthorized'), 401);

if (!is_file(__DIR__ . '/config.php')) kargom_out(array('error' => 'Put kargom-connect.php next to config.php in your OpenCart folder'), 500);
require_once __DIR__ . '/config.php';
if (!defined('DB_HOSTNAME') || !defined('DB_DATABASE')) kargom_out(array('error' => 'OpenCart database settings not found in config.php'), 500);

mysqli_report(MYSQLI_REPORT_OFF);
$db = @new mysqli(DB_HOSTNAME, DB_USERNAME, DB_PASSWORD, DB_DATABASE, defined('DB_PORT') ? (int)DB_PORT : 3306);
if ($db->connect_error) kargom_out(array('error' => 'Could not open the shop database'), 500);
$db->set_charset('utf8mb4');
$P = DB_PREFIX;

function kargom_rows($db, $sql) {
    $r = $db->query($sql);
    $out = array();
    if ($r instanceof mysqli_result) { while ($row = $r->fetch_assoc()) $out[] = $row; }
    return $out;
}
function kargom_setting($db, $P, $key) {
    $k = $db->real_escape_string($key);
    $rows = kargom_rows($db, "SELECT `value` FROM `{$P}setting` WHERE `store_id` = 0 AND `key` = '$k' LIMIT 1");
    return $rows ? $rows[0]['value'] : null;
}
function kargom_language_id($db, $P) {
    $code = kargom_setting($db, $P, 'config_language');
    if ($code === null) $code = kargom_setting($db, $P, 'config_language_admin');
    if ($code !== null) {
        $c = $db->real_escape_string($code);
        $rows = kargom_rows($db, "SELECT `language_id` FROM `{$P}language` WHERE `code` = '$c' LIMIT 1");
        if ($rows) return (int)$rows[0]['language_id'];
    }
    return 1;
}
function kargom_ids($list) {
    $ids = array();
    foreach ($list as $v) { $n = (int)$v; if ($n > 0) $ids[] = $n; }
    return array_values(array_unique($ids));
}

$lang = kargom_language_id($db, $P);
$action = isset($_GET['action']) ? $_GET['action'] : 'ping';

if ($action === 'ping') {
    $statuses = kargom_rows($db, "SELECT `order_status_id` AS id, `name` FROM `{$P}order_status` WHERE `language_id` = $lang ORDER BY `order_status_id`");
    $processing = json_decode((string)kargom_setting($db, $P, 'config_processing_status'), true);
    kargom_out(array(
        'ok' => true,
        'connector' => KARGOM_CONNECTOR_VERSION,
        'opencart' => defined('VERSION') ? VERSION : null,
        'name' => (string)kargom_setting($db, $P, 'config_name'),
        'statuses' => $statuses,
        'processing' => is_array($processing) ? kargom_ids($processing) : array(),
    ));
}

if ($action === 'orders') {
    $want = isset($_GET['statuses']) ? kargom_ids(explode(',', $_GET['statuses'])) : array();
    if (!$want) {
        $processing = json_decode((string)kargom_setting($db, $P, 'config_processing_status'), true);
        $want = is_array($processing) ? kargom_ids($processing) : array();
    }
    if (!$want) $want = array(2); // "Processing" in a standard OpenCart
    $in = implode(',', $want);
    $orders = kargom_rows($db, "SELECT o.`order_id`, o.`invoice_prefix`, o.`date_added`, o.`email`, o.`telephone`, o.`firstname`, o.`lastname`,
        o.`shipping_firstname`, o.`shipping_lastname`, o.`shipping_company`, o.`shipping_address_1`, o.`shipping_address_2`, o.`shipping_city`, o.`shipping_postcode`, o.`shipping_country_id`, o.`shipping_zone`,
        o.`payment_firstname`, o.`payment_lastname`, o.`payment_company`, o.`payment_address_1`, o.`payment_address_2`, o.`payment_city`, o.`payment_postcode`, o.`payment_country_id`,
        o.`total`, o.`currency_code`, o.`currency_value`, o.`order_status_id`, sc.`iso_code_2` AS shipping_iso, pc.`iso_code_2` AS payment_iso
        FROM `{$P}order` o
        LEFT JOIN `{$P}country` sc ON sc.`country_id` = o.`shipping_country_id`
        LEFT JOIN `{$P}country` pc ON pc.`country_id` = o.`payment_country_id`
        WHERE o.`order_status_id` IN ($in) ORDER BY o.`order_id` DESC LIMIT 100");
    foreach ($orders as &$o) {
        $id = (int)$o['order_id'];
        $o['products'] = kargom_rows($db, "SELECT op.`name`, op.`model`, op.`quantity`, op.`price`, p.`weight`, wcd.`unit` AS weight_unit
            FROM `{$P}order_product` op
            LEFT JOIN `{$P}product` p ON p.`product_id` = op.`product_id`
            LEFT JOIN `{$P}weight_class_description` wcd ON wcd.`weight_class_id` = p.`weight_class_id` AND wcd.`language_id` = $lang
            WHERE op.`order_id` = $id");
    }
    unset($o);
    kargom_out(array('ok' => true, 'orders' => $orders));
}

if ($action === 'ship') {
    $id = isset($body['order_id']) ? (int)$body['order_id'] : 0;
    $comment = isset($body['comment']) ? substr(strip_tags((string)$body['comment']), 0, 1000) : '';
    if ($id <= 0 || $comment === '') kargom_out(array('error' => 'order_id and comment are needed'), 400);
    $order = kargom_rows($db, "SELECT `order_id`, `order_status_id` FROM `{$P}order` WHERE `order_id` = $id LIMIT 1");
    if (!$order) kargom_out(array('error' => 'Order not found'), 404);
    $status = isset($body['status_id']) ? (int)$body['status_id'] : 0;
    if ($status <= 0) {
        $rows = kargom_rows($db, "SELECT `order_status_id` FROM `{$P}order_status` WHERE `language_id` = $lang AND `name` IN ('Shipped', 'Dispatched', 'Kargoya Verildi') ORDER BY `order_status_id` LIMIT 1");
        $status = $rows ? (int)$rows[0]['order_status_id'] : (int)$order[0]['order_status_id'];
    }
    $c = $db->real_escape_string($comment);
    $ok = $db->query("INSERT INTO `{$P}order_history` SET `order_id` = $id, `order_status_id` = $status, `notify` = 1, `comment` = '$c', `date_added` = NOW()")
        && $db->query("UPDATE `{$P}order` SET `order_status_id` = $status, `date_modified` = NOW() WHERE `order_id` = $id");
    if (!$ok) kargom_out(array('error' => 'Could not update the order'), 500);
    kargom_out(array('ok' => true, 'order_id' => $id, 'status_id' => $status));
}

kargom_out(array('error' => 'Unknown action'), 400);
