package com.hiwon.mvp

import android.content.Context
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import android.net.Uri
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.rememberLauncherForActivityResult
import java.net.URL
import java.net.HttpURLConnection
import java.net.URLEncoder
import android.os.Looper
import android.os.Handler
import android.text.format.DateFormat
import android.widget.Toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.painterResource
import androidx.core.content.FileProvider
import androidx.browser.customtabs.CustomTabsIntent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.NumberFormat
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale
import java.util.UUID
import java.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

enum class Tab { HOME, CUSTOMER, QUOTE, CONTRACT, PAYMENT, MORE }

data class Customer(
    val name: String,
    val phone: String,
    val address: String,
    val addressDetail: String = ""
)

data class QuoteItem(val name: String, val qty: Double, val unitPrice: Double, val spec: String = "", val inputError: String = "", val editorId: String = UUID.randomUUID().toString()) {
    constructor(name: String, qty: Int, unitPrice: Int, spec: String = "") : this(name, qty.toDouble(), unitPrice.toDouble(), spec)
}
data class Quote(
    val id: String,
    val customer: String,
    val phone: String,
    val address: String,
    val siteAddress: String,
    val items: List<QuoteItem>,
    val vatEnabled: Boolean,
    val discountAmount: Double = 0.0,
    val validityDays: Int = 15,
    val note: String,
    val status: String,
    val createdAt: String,
    val template: String = "CLASSIC",
    val customerAddressDetail: String = "",
    val siteAddressDetail: String = "",
    // 1 = 기존 계산 방식(호환 유지), 2 = 입력 단가 기본 '부가세 포함' 방식
    val pricingVersion: Int = 1,
    val sentAt: String = ""
) {
    private val amounts: QuoteAmounts get() = calculateQuoteAmounts(items.map { PriceLine(it.qty, it.unitPrice) }, discountAmount, vatEnabled, pricingVersion)
    val supply: Int get() = amounts.supply
    val discountedSupply: Int get() = amounts.discountedSupply
    val usesVatIncludedPricing: Boolean get() = pricingVersion >= 2
    val vat: Int get() = amounts.vat
    val total: Int get() = amounts.total
    val validUntil: String get() = runCatching { LocalDate.parse(createdAt).plusDays(validityDays.toLong()).toString() }.getOrDefault(createdAt)
    val itemSummary: String get() = items.firstOrNull()?.name ?: "견적"
}
fun defaultStandardContractTerms(): String = """제1조 [계약 목적] 본 계약은 계약서 및 견적서에 기재된 공사·용역을 약정된 조건에 따라 수행하는 것을 목적으로 합니다.
제2조 [공사 범위] 작업 범위와 품목·수량·금액은 본 계약서와 연결된 견적서를 기준으로 하며, 추가·변경 작업은 상호 협의 후 별도 비용으로 처리합니다.
제3조 [계약금액 및 지급] 고객은 계약금·중도금·잔금을 계약서에 기재된 금액과 지급예정일에 지급합니다.
제4조 [시공 일정] 시공예정일은 현장 여건, 자재 수급, 천재지변 등 불가피한 사유가 있는 경우 상호 협의하여 변경할 수 있습니다.
제5조 [고객 협조] 고객은 작업에 필요한 출입, 전기·수도 사용 및 작업 공간 확보 등 합리적인 협조를 제공합니다.
제6조 [추가·변경공사] 계약 후 고객 요청 또는 현장 조건으로 추가 작업이 필요한 경우 내용과 비용을 사전에 협의합니다.
제7조 [하자 및 보수] 시공상 하자가 확인되는 경우 관계 법령, 제조사 기준 및 별도 약정에 따라 보수합니다. 고객 과실·외부 충격·소모품·제조사 제품 자체 결함 등 시공 외 원인은 별도로 처리할 수 있습니다.
제8조 [계약 해제·취소] 계약 취소·해제 시 이미 발생한 자재비, 제작비, 운송비, 작업비 등 실제 발생 비용은 정산할 수 있습니다.
제9조 [분쟁 처리] 분쟁 발생 시 당사자는 우선 협의하여 해결하고, 해결되지 않는 경우 관계 법령 및 관할 법원의 절차에 따릅니다.
제10조 [계약 확인] 고객은 계약내용, 견적, 지급조건, 표준 계약조건 및 현장 특약사항을 확인한 후 서명 또는 전자적 방법으로 동의합니다."""

private val contractTypes = listOf("공사·설치", "물품·제품 납품", "서비스·용역", "프리랜서·도급", "유지보수")

private fun contractTermsFor(type: String): String {
    val scope = when (type) {
        "물품·제품 납품" -> "납품할 품목, 수량, 인도일, 장소 및 검수 기준은 계약서와 연결된 견적서에 따릅니다."
        "서비스·용역" -> "제공할 서비스의 범위, 결과물 및 완료 기준은 계약서와 연결된 견적서에 따릅니다."
        "프리랜서·도급" -> "수행할 업무, 결과물, 납기 및 검수 기준은 계약서와 연결된 견적서에 따릅니다."
        "유지보수" -> "유지보수 대상, 점검 주기, 대응 범위와 제외 항목은 계약서와 연결된 견적서에 따릅니다."
        else -> "시공 범위, 품목, 수량과 완료 기준은 계약서와 연결된 견적서에 따릅니다."
    }
    return """제1조 [계약 목적] 갑(고객)과 을(공급자)은 본 계약서 및 연결된 견적서에 기재된 $type 업무를 약정된 조건에 따라 진행합니다.
제2조 [업무 범위] $scope 추가·변경은 양 당사자가 내용과 비용을 확인한 뒤 진행합니다.
제3조 [계약금액 및 지급] 갑은 계약서에 기재된 계약금·중도금·잔금을 해당 지급예정일에 지급합니다.
제4조 [일정] 작업 또는 납품 일정은 현장 여건, 자재 수급 등 불가피한 사유가 있을 때 상호 협의해 조정합니다.
제5조 [협조] 갑과 을은 업무 수행과 검수에 필요한 정보를 제공하고 합리적으로 협조합니다.
제6조 [변경] 추가 업무의 범위·금액·일정은 사전에 서면 또는 전자적 방법으로 합의합니다.
제7조 [하자 및 보수] 하자나 불완전 이행은 관계 법령 및 당사자가 정한 보증 조건에 따라 처리합니다.
제8조 [해제·취소] 해제·취소 시 실제 이행분과 발생 비용은 관계 법령과 당사자의 합의에 따라 정산합니다.
제9조 [분쟁 처리] 분쟁은 우선 협의하고, 관계 법령상 허용되는 범위에서 을의 본점 또는 주된 영업소 소재지 관할법원을 제1심 합의관할법원으로 합니다. 소비자에게 부당하게 불리하거나 법령상 다른 관할이 적용되는 경우에는 해당 법령에 따릅니다.
제10조 [계약 확인] 갑과 을은 계약내용, 지급조건, 계약조건 및 특약을 확인하고 각각 직접 서명합니다.
제11조 [소유권] 본 계약에 물품·제품의 공급이 포함된 경우, 잔금을 포함한 계약대금 전액이 완납될 때까지 해당 물품·제품의 소유권은 관계 법령상 허용되는 범위에서 을에게 유보됩니다."""
}

data class Contract(
    val id: String,
    val quoteId: String,
    val customer: String,
    val item: String,
    val amount: Int,
    val signed: Boolean,
    val paidAmount: Int,
    val phone: String = "",
    val address: String = "",
    val contractDate: String = LocalDate.now().toString(),
    val workDate: String = "",
    val depositAmount: Int = 0,
    val depositDueDate: String = "",
    val middleAmount: Int = 0,
    val middleDueDate: String = "",
    val balanceAmount: Int = amount,
    val balanceDueDate: String = "",
    val standardTerms: String = contractTermsFor("공사·설치"),
    val specialTerms: String = "",
    val signatureName: String = "",
    val signaturePath: String = "",
    val signatureMethod: String = "",
    val identityStatus: String = "미인증",
    val consentAccepted: Boolean = false,
    val signedAt: String = "",
    val paymentHidden: Boolean = false,
    val debtStatus: String = "미수",
    val firstDemandAt: String = "",
    val demandDueDate: String = "",
    val certifiedMailAt: String = "",
    val legalPreparedAt: String = "",
    val debtMemo: String = "",
    val siteAddress: String = "",
    val siteAddressDetail: String = "",
    val finalConfirmed: Boolean = false,
    val finalConfirmedAt: String = "",
    val contractType: String = "공사·설치"
)

data class AppData(val customers: List<Customer>, val quotes: List<Quote>, val contracts: List<Contract>)

fun defaultEmploymentContractTerms(): String = """제1조 [근로계약] 사용자와 근로자는 관계 법령에 따라 근로계약을 체결합니다.
제2조 [근로계약기간] 계약기간은 계약서에 기재된 기간으로 합니다.
제3조 [근무장소 및 업무] 근무장소와 담당 업무는 계약서 기재내용을 기준으로 합니다.
제4조 [근로시간 및 휴게] 소정근로시간, 근무일 및 휴게시간은 계약서 기재내용과 관계 법령을 따릅니다.
제5조 [임금] 기본급, 수당, 임금지급일 및 지급방법은 계약서에 정한 내용에 따릅니다.
제6조 [휴일 및 휴가] 주휴일과 연차유급휴가 등은 관계 법령에 따릅니다.
제7조 [사회보험 및 공제] 적용되는 사회보험, 세금 및 공제는 관계 법령에 따라 처리합니다.
제8조 [계약서 교부] 사용자는 체결된 근로계약서를 근로자에게 교부합니다.
제9조 [기타] 본 계약에 정하지 않은 사항은 관계 법령, 취업규칙 및 상호 합의에 따릅니다."""

data class Employee(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val phone: String,
    val position: String,
    val joinDate: String,
    val status: String = "근무중",
    val address: String = "",
    val addressDetail: String = "",
    val memo: String = "",
    val contractStart: String = "",
    val contractEnd: String = "",
    val workplace: String = "",
    val duty: String = "",
    val workHours: String = "09:00~18:00",
    val breakTime: String = "12:00~13:00",
    val baseSalary: Int = 0,
    val allowance: Int = 0,
    val mealAllowance: Int = 0,
    val bonus: Int = 0,
    val deductions: Int = 0,
    val payday: Int = 25,
    val employmentTerms: String = defaultEmploymentContractTerms(),
    val contractSigned: Boolean = false,
    val lastPayrollMonth: String = "",
    val payrollPaid: Boolean = false
) {
    val grossPay: Int get() = baseSalary + allowance + mealAllowance + bonus
    val netPay: Int get() = (grossPay - deductions).coerceAtLeast(0)
    val fullAddress: String get() = listOf(address.trim(), addressDetail.trim()).filter { it.isNotBlank() }.joinToString(" ")
}

internal fun loadEmployees(context: Context): List<Employee> {
    return runCatching {
        val raw = context.getSharedPreferences("onebiz_employee", Context.MODE_PRIVATE)
            .getString("employees", "[]") ?: "[]"
        val arr = JSONArray(raw)
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                add(Employee(
                    id = o.optString("id", UUID.randomUUID().toString()),
                    name = o.optString("name"),
                    phone = o.optString("phone"),
                    position = o.optString("position"),
                    joinDate = o.optString("joinDate"),
                    status = o.optString("status", "근무중"),
                    address = o.optString("address"),
                    addressDetail = o.optString("addressDetail"),
                    memo = o.optString("memo"),
                    contractStart = o.optString("contractStart"),
                    contractEnd = o.optString("contractEnd"),
                    workplace = o.optString("workplace"),
                    duty = o.optString("duty"),
                    workHours = o.optString("workHours", "09:00~18:00"),
                    breakTime = o.optString("breakTime", "12:00~13:00"),
                    baseSalary = o.optInt("baseSalary"),
                    allowance = o.optInt("allowance"),
                    mealAllowance = o.optInt("mealAllowance"),
                    bonus = o.optInt("bonus"),
                    deductions = o.optInt("deductions"),
                    payday = o.optInt("payday", 25),
                    employmentTerms = o.optString("employmentTerms", defaultEmploymentContractTerms()),
                    contractSigned = o.optBoolean("contractSigned"),
                    lastPayrollMonth = o.optString("lastPayrollMonth"),
                    payrollPaid = o.optBoolean("payrollPaid")
                ))
            }
        }
    }.getOrDefault(emptyList())
}

private fun employeesToJson(employees: List<Employee>): JSONArray {
    val arr = JSONArray()
    employees.forEach { e ->
        arr.put(JSONObject().apply {
            put("id", e.id); put("name", e.name); put("phone", e.phone); put("position", e.position)
            put("joinDate", e.joinDate); put("status", e.status); put("address", e.address); put("addressDetail", e.addressDetail)
            put("memo", e.memo); put("contractStart", e.contractStart); put("contractEnd", e.contractEnd)
            put("workplace", e.workplace); put("duty", e.duty); put("workHours", e.workHours); put("breakTime", e.breakTime)
            put("baseSalary", e.baseSalary); put("allowance", e.allowance); put("mealAllowance", e.mealAllowance)
            put("bonus", e.bonus); put("deductions", e.deductions); put("payday", e.payday)
            put("employmentTerms", e.employmentTerms); put("contractSigned", e.contractSigned); put("lastPayrollMonth", e.lastPayrollMonth); put("payrollPaid", e.payrollPaid)
        })
    }
    return arr
}

internal fun saveEmployees(context: Context, employees: List<Employee>) {
    val prefs = context.getSharedPreferences("onebiz_employee", Context.MODE_PRIVATE)
    val raw = JSONArray(prefs.getString("employees", "[]").orEmpty())
    val before = employeesToJson(loadEmployees(context))
    check(raw.length() == before.length()) { "직원 자료를 읽지 못해 저장을 중단했습니다. 기기 자료를 먼저 보관해 주세요." }
    var recoveryNeeded = false
    val preserved = OnebizSnapshotPreservation.preserveArray(raw, before, employeesToJson(employees)) { recoveryNeeded = true }
    if (recoveryNeeded && !preserveOnebizBeforeModelChange(context)) return
    prefs.edit().putString("employees", preserved.toString()).apply()
}


private fun upsertCustomer(list: List<Customer>, customer: Customer): List<Customer> {
    val normalized = customer.copy(
        name = customer.name.trim(),
        phone = formatMobilePhone(customer.phone.filter(Char::isDigit).take(11)),
        address = customer.address.trim(),
        addressDetail = customer.addressDetail.trim()
    )
    val phoneKey = normalized.phone.filter(Char::isDigit)
    // 휴대폰 번호가 같은 고객은 기존 정보를 최신 입력값으로 갱신한다.
    // 번호가 비어 있으면 같은 이름의 고객도 별도 등록할 수 있게 막지 않는다.
    val sameIndex = if (phoneKey.isNotBlank()) {
        list.indexOfFirst { it.phone.filter(Char::isDigit) == phoneKey }
    } else -1
    return if (sameIndex >= 0) {
        list.toMutableList().also { it[sameIndex] = normalized }
    } else {
        list + normalized
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Account ownership is resolved before any remembered UI state can read local data.
        val accountReady = runCatching {
            if (onebizCloudUserId(this).isBlank()) onebizCloudPrefs(this).edit().remove("token").commit()
            val authenticated = onebizCloudToken(this).isNotBlank() && onebizCloudUserId(this).isNotBlank()
            if (authenticated) OnebizGuestWorkspace.markExistingMember(this)
            val ownerId = if (authenticated) onebizCloudUserId(this) else OnebizGuestWorkspace.prepare(this)
            OnebizAccountStorage.initialize(this, ownerId)
            prepareOnebizLocalData(this)
        }.isSuccess
        if (!accountReady) {
            setContent {
                MaterialTheme {
                    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
                        Text("계정 자료를 안전하게 열지 못했습니다. 기기 저장 공간을 확인한 뒤 다시 시도해 주세요. 자료를 덮어쓰지 않았습니다.")
                        Button(onClick = { recreate() }) { Text("다시 시도") }
                    }
                }
            }
            return
        }
        OnebizDocumentNotifications.createChannel(this)
        DocumentCenterNavigation.accept(this, intent)
        Toast.makeText(this, OnebizGuestServicePolicy.startupNotice(OnebizGuestWorkspace.isActive(this)), Toast.LENGTH_LONG).show()
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Purple, background = Bg, surface = Color.White)) {
                Box(Modifier.fillMaxSize().safeDrawingPadding()) { HiwonApp() }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        DocumentCenterNavigation.accept(this, intent)
    }
}

@Composable
fun HiwonApp() {
    val context = LocalContext.current
    var accountScope by remember { mutableStateOf(OnebizGuestWorkspace.scope(context)) }
    LaunchedEffect(Unit) {
        while (true) {
            accountScope = OnebizGuestWorkspace.scope(context)
            delay(250)
        }
    }
    key(accountScope) { HiwonAccountApp(accountScope) }
}

@Composable
private fun HiwonAccountApp(accountScope: String) {
    val context = LocalContext.current
    val initial = remember { loadData(context) }
    var customers by remember { mutableStateOf(initial.customers) }
    var quotes by remember { mutableStateOf(initial.quotes) }
    var contracts by remember { mutableStateOf(initial.contracts) }
    var tab by remember { mutableStateOf(Tab.HOME) }
    var quoteEditor by rememberSaveable(accountScope) { mutableStateOf(false) }
    var editingQuote by rememberSaveable(accountScope, stateSaver = nullableQuoteSaver) { mutableStateOf<Quote?>(null) }
    var copiedQuote by rememberSaveable(accountScope, stateSaver = nullableQuoteSaver) { mutableStateOf<Quote?>(null) }
    var addCustomer by remember { mutableStateOf(false) }
    var editingContract by remember { mutableStateOf<Contract?>(null) }
    var businessProfile by remember { mutableStateOf(loadBusinessProfile(context)) }
    var showBusinessProfile by remember { mutableStateOf(false) }
    var cloudToken by remember { mutableStateOf(onebizCloudToken(context)) }
    var pendingPairing by remember { mutableStateOf(onebizPendingRequestId(context)) }
    var localStartBusy by remember { mutableStateOf(false) }
    var cloudReady by remember { mutableStateOf(false) }
    var cloudStatus by remember { mutableStateOf("원비즈 계정 확인 중...") }
    var visibleGeneration by remember { mutableStateOf(OnebizAccountStorage.generation(context)) }
    var showDispatchRoom by remember { mutableStateOf(false) }
    var showEmployeeManager by remember { mutableStateOf(false) }
    var showSchedule by remember { mutableStateOf(false) }
    var schedules by remember { mutableStateOf(loadSchedules(context)) }
    var quoteAwaitingSendConfirmation by remember { mutableStateOf<Quote?>(null) }
    var quoteFromSchedule by remember { mutableStateOf<Quote?>(null) }
    var quoteAlimtalkTarget by remember { mutableStateOf<Quote?>(null) }
    var employees by remember { mutableStateOf(loadEmployees(context)) }
    var showDocumentCenter by rememberSaveable(accountScope) { mutableStateOf(false) }
    var documentDestination by rememberSaveable(accountScope) { mutableStateOf("documents") }
    var documentTargetId by rememberSaveable(accountScope) { mutableStateOf("") }
    val documentCenterState by DocumentCenterRepository.state.collectAsState()
    val documentNavigation by DocumentCenterNavigation.pending.collectAsState()
    DocumentCenterLifecycle(accountScope, cloudToken)
    LaunchedEffect(documentNavigation, accountScope) {
        val request = documentNavigation
        if (request != null && request.userId == accountScope && onebizSessionMatches(context, cloudToken, accountScope)) {
            documentDestination = "notifications"
            documentTargetId = request.documentId
            showDocumentCenter = true
            DocumentCenterNavigation.consume(request)
        }
    }

    BackHandler(enabled = showDocumentCenter || showSchedule || showEmployeeManager || showDispatchRoom || quoteEditor || editingContract != null || addCustomer || tab != Tab.HOME) {
        when {
            showDocumentCenter -> showDocumentCenter = false
            showSchedule -> showSchedule = false
            showEmployeeManager -> showEmployeeManager = false
            showDispatchRoom -> showDispatchRoom = false
            quoteEditor -> Unit // QuoteEditorScreen owns the back button and unsaved-draft confirmation.
            editingContract != null -> editingContract = null
            addCustomer -> addCustomer = false
            tab != Tab.HOME -> tab = Tab.HOME
        }
    }

    LaunchedEffect(Unit) {
        while (true) {
            val latest = onebizCloudToken(context)
            if (latest != cloudToken) cloudToken = latest
            val pending = onebizPendingRequestId(context)
            if (pending != pendingPairing) pendingPairing = pending
            if (cloudReady && (accountScope == onebizCloudUserId(context) || OnebizGuestWorkspace.isActive(context)) && accountScope == OnebizAccountStorage.owner(context)) {
                val generation = OnebizAccountStorage.generation(context)
                if (generation != visibleGeneration) {
                    val data = loadData(context)
                    customers = data.customers
                    quotes = data.quotes
                    contracts = data.contracts
                    employees = loadEmployees(context)
                    schedules = loadSchedules(context)
                    businessProfile = loadBusinessProfile(context)
                    visibleGeneration = generation
                }
                cloudStatus = if (OnebizGuestWorkspace.isGuestScope(accountScope)) "이 기기에만 저장 중 · 백업을 설정해 주세요"
                else onebizSyncStatus(context)
            }
            delay(500)
        }
    }

    LaunchedEffect(cloudToken) {
        cloudReady = false
        if (cloudToken.isBlank()) {
            if (OnebizGuestWorkspace.isActive(context) && accountScope == OnebizGuestWorkspace.id(context)) {
                cloudStatus = "이 기기에만 저장 중 · 클라우드 복구 미설정"
                showBusinessProfile = !businessProfile.isReady
                cloudReady = true
            } else {
                cloudStatus = "기존 계정 로그인이 필요합니다"
            }
            return@LaunchedEffect
        }
        if (accountScope != onebizCloudUserId(context) || accountScope != OnebizAccountStorage.owner(context)) return@LaunchedEffect
        val requestedToken = cloudToken
        cloudStatus = "최신 데이터 확인 중..."
        pullOnebizCloudState(context) { ok, msg, state ->
            Handler(Looper.getMainLooper()).post {
                if (!onebizSessionMatches(context, requestedToken, accountScope)) return@post
                if (ok && state != null) {
                    businessProfile = state.profile
                    customers = state.data.customers
                    quotes = state.data.quotes
                    contracts = state.data.contracts
                    employees = state.employees
                    schedules = state.schedules
                    showBusinessProfile = !state.profile.isReady
                    cloudStatus = msg
                } else {
                    showBusinessProfile = !businessProfile.isReady
                    cloudStatus = "오프라인 사용 · $msg"
                }
                visibleGeneration = OnebizAccountStorage.generation(context)
                cloudReady = true
            }
        }
    }

    LaunchedEffect(customers, quotes, contracts, businessProfile, employees, schedules, cloudToken, cloudReady, visibleGeneration) {
        if (!cloudReady || !OnebizGuestWorkspace.canWrite(context, cloudToken, accountScope) ||
            visibleGeneration != OnebizAccountStorage.generation(context)) return@LaunchedEffect
        synchronized(OnebizSyncRuntime.lock) {
            if (!OnebizGuestWorkspace.canWrite(context, cloudToken, accountScope) ||
                visibleGeneration != OnebizAccountStorage.generation(context)) return@LaunchedEffect
            if (!onebizLocalDataIsValid(context)) {
                cloudStatus = "기기 자료 형식에 오류가 있어 자동 저장을 중단했습니다. 원비즈를 다시 실행해 자료를 확인해 주세요."
                return@LaunchedEffect
            }
            saveData(context, customers, quotes, contracts)
            saveEmployees(context, employees)
            saveSchedules(context, schedules)
            saveItemPhrases(context, quotes.flatMap { q -> q.items.map { it.name } })
        }
        if (cloudReady && businessProfile.isReady && cloudToken.isNotBlank()) {
            delay(700)
            syncOnebizAdminSnapshot(context, businessProfile, quotes, contracts, employees, expectedUserId = accountScope) { _, message ->
                Handler(Looper.getMainLooper()).post {
                    if (onebizSessionMatches(context, cloudToken, accountScope)) cloudStatus = message
                }
            }
        }
    }

    // Do not show a social-login screen. An older account may still have a
    // protected, separately backed-up workspace. Never claim it belongs to a
    // new guest automatically or merge its documents without verification.
    if (cloudToken.isBlank() && !OnebizGuestWorkspace.isActive(context)) {
        Column(
            Modifier.fillMaxSize().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text("원비즈", fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Text("로그인 없이 새로 시작할 수 있습니다.", textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
            Text(
                "이전에 사용한 계정의 문서는 별도로 보관되며, 새 문서함에 자동으로 합쳐지지 않습니다. 앱을 삭제하지 마세요.",
                fontSize = 13.sp, color = Muted, textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(20.dp))
            Button(enabled = !localStartBusy, onClick = {
                localStartBusy = true
                Thread {
                    val result = runCatching { OnebizGuestWorkspace.startLocalWithoutLogin(context) }
                    Handler(Looper.getMainLooper()).post {
                        localStartBusy = false
                        result.onFailure {
                            Toast.makeText(context, "기존 자료를 보호하기 위해 새 시작을 중단했습니다. 저장 공간을 확인해 주세요.", Toast.LENGTH_LONG).show()
                        }
                    }
                }.start()
            }) { Text(if (localStartBusy) "준비 중…" else "로그인 없이 시작") }
        }
        return
    }

    if (accountScope != OnebizAccountStorage.owner(context)) {
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            Text("계정 자료를 안전하게 전환하지 못했습니다. 기기 저장 공간을 확인한 뒤 원비즈를 다시 실행해 주세요.")
        }
        return
    }

    if (!cloudReady) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator()
                Text(cloudStatus, color = Muted)
            }
        }
        return
    }

    Scaffold(
        containerColor = Bg,
        topBar = {
            if (OnebizGuestWorkspace.isGuestScope(accountScope) && tab != Tab.MORE) {
                Surface(color = OrangeSoft) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("기기 전용 사용 중 · 삭제·분실 시 자료를 복구할 수 없습니다.", fontSize = 12.sp, modifier = Modifier.weight(1f))
                        TextButton(onClick = { tab = Tab.MORE }) { Text("백업") }
                    }
                }
            } else if (onebizSyncBlocked(context) && tab != Tab.MORE) {
                Surface(color = OrangeSoft) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("자료 확인이 필요합니다. 기존 자료는 유지됩니다.", fontSize = 12.sp, modifier = Modifier.weight(1f))
                        TextButton(onClick = { tab = Tab.MORE }) { Text("확인") }
                    }
                }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Color.White) {
                BottomItem(Tab.HOME, tab, "홈", Icons.Default.Home) { showDocumentCenter = false; showSchedule = false; tab = it }
                NavigationBarItem(
                    selected = tab == Tab.QUOTE || tab == Tab.CONTRACT || tab == Tab.PAYMENT,
                    onClick = { showDocumentCenter = false; showSchedule = false; tab = Tab.QUOTE },
                    icon = { Icon(Icons.Default.Description, null) },
                    label = { Text("문서") },
                    colors = NavigationBarItemDefaults.colors(indicatorColor = BlueSoft, selectedIconColor = Color(0xFF0875EA), selectedTextColor = Color(0xFF0875EA))
                )
                BottomItem(Tab.MORE, tab, "내 정보", Icons.Default.Person) { showDocumentCenter = false; showSchedule = false; tab = it }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                Tab.HOME -> HomeScreen(customers, quotes, contracts, schedules, { tab = Tab.QUOTE }, { tab = Tab.CUSTOMER }, { tab = it }, { showDispatchRoom = true }, { showEmployeeManager = true }, { showSchedule = true },
                    documentUnreadCount = documentCenterState.data?.takeIf { it.userId == accountScope }?.unreadCount ?: 0,
                    onDocuments = {
                        if (OnebizGuestWorkspace.isGuestScope(accountScope)) Toast.makeText(context, "로그인 없는 모드에서는 온라인 발송 기록을 아직 조회할 수 없습니다. 저장된 문서는 문서 목록에서 확인해 주세요.", Toast.LENGTH_LONG).show()
                        else { documentDestination = "documents"; documentTargetId = ""; showDocumentCenter = true }
                    },
                    onInbox = {
                        if (OnebizGuestWorkspace.isGuestScope(accountScope)) Toast.makeText(context, "로그인 없는 모드에서는 온라인 알림함을 아직 지원하지 않습니다.", Toast.LENGTH_LONG).show()
                        else { documentDestination = "notifications"; documentTargetId = ""; showDocumentCenter = true }
                    })
                Tab.CUSTOMER -> CustomerScreen(
                    customers = customers,
                    onAdd = { addCustomer = true },
                    onUpdate = { old, updated ->
                        val changed = customers.map { if (it == old) updated else it }
                        customers = changed
                        synchronized(OnebizSyncRuntime.lock) {
                            if (OnebizGuestWorkspace.canWrite(context, cloudToken, accountScope) && visibleGeneration == OnebizAccountStorage.generation(context)) saveData(context, changed, quotes, contracts)
                        }
                    },
                    onDelete = { customer ->
                        val changed = customers.filterNot { it == customer }
                        customers = changed
                        synchronized(OnebizSyncRuntime.lock) {
                            if (OnebizGuestWorkspace.canWrite(context, cloudToken, accountScope) && visibleGeneration == OnebizAccountStorage.generation(context)) saveData(context, changed, quotes, contracts)
                        }
                    }
                )
                Tab.QUOTE -> QuoteScreen(quotes, contracts = contracts, industry = businessProfile.industry,
                    onNew = { editingQuote = null; copiedQuote = null; quoteEditor = true }, onExample = { definition ->
                    // A selected industry example starts an UNSAVED draft; existing customer/server data is untouched.
                    editingQuote = null
                    copiedQuote = definition.toNewDraft(nextQuoteId(quotes, contracts))
                    quoteEditor = true
                }, onAlimtalk = {
                    if (OnebizGuestWorkspace.isGuestScope(accountScope)) Toast.makeText(context, OnebizGuestServicePolicy.unavailableReason("알림톡"), Toast.LENGTH_LONG).show()
                    else quoteAlimtalkTarget = it
                }, onDelivered = { q ->
                    quotes = quotes.map { current ->
                        if (current.id == q.id) current.copy(status = "발송접수", sentAt = LocalDate.now().toString()) else current
                    }
                }, onKakao = { q ->
                    if (shareQuotePdf(context, q, kakaoOnly = true)) {
                        quoteAwaitingSendConfirmation = q
                    }
                }, onPdf = { shareQuotePdf(context, it) }, onCopy = { q ->
                    editingQuote = null
                    copiedQuote = q.copy(
                        id = nextQuoteId(quotes, contracts),
                        status = "작성중",
                        createdAt = LocalDate.now().toString()
                    )
                    quoteEditor = true
                }, onEdit = { q ->
                    copiedQuote = null
                    editingQuote = q
                    quoteEditor = true
                }, onDelete = { q ->
                    quotes = quotes.filterNot { it.id == q.id }
                }, onContract = { q ->
                    // 견적→계약 전환은 반드시 사용자가 누른 현재 견적 데이터를 기준으로 한다.
                    // 과거에 삭제된 견적 번호가 재사용되어 이전 계약과 충돌하던 문제를 방지한다.
                    val existing = contracts.firstOrNull { it.quoteId == q.id }
                    val isSameSource = existing != null &&
                        existing.customer == q.customer &&
                        existing.amount == q.total &&
                        existing.item == q.itemSummary

                    when {
                        existing == null -> {
                            val created = contractFromQuote(q, nextContractId(contracts))
                            contracts = contracts + created
                            editingContract = created
                        }
                        !existing.signed -> {
                            // 같은 견적의 작성중 계약은 최신 견적의 이름/금액/연락처/주소로 동기화한다.
                            val refreshed = existing.copy(
                                customer = q.customer,
                                item = q.itemSummary,
                                amount = q.total,
                                phone = q.phone,
                                address = q.address,
                                siteAddress = q.siteAddress,
                                siteAddressDetail = q.siteAddressDetail,
                                balanceAmount = (q.total - existing.depositAmount - existing.middleAmount).coerceAtLeast(0)
                            )
                            contracts = contracts.map { if (it.id == refreshed.id) refreshed else it }
                            editingContract = refreshed
                        }
                        isSameSource -> {
                            editingContract = existing
                        }
                        else -> {
                            // 서명 완료된 과거 계약과 견적번호가 우연히 충돌한 경우 새 계약으로 분리한다.
                            val created = contractFromQuote(q, nextContractId(contracts))
                            contracts = contracts + created
                            editingContract = created
                        }
                    }
                    tab = Tab.CONTRACT
                })
                Tab.CONTRACT -> ContractScreen(
                    contracts = contracts,
                    onEdit = { editingContract = it },
                    onPdf = { shareContractPdf(context, it) },
                    onKakaoSign = {
                        if (OnebizGuestWorkspace.isGuestScope(accountScope)) {
                            if (it.signed && it.signatureMethod == "카카오톡 웹서명") shareOnebizGuestSignedOriginal(context, it)
                            else if (it.signed) shareContractPdf(context, it)
                            else shareOnebizGuestKakaoSignRequest(context, it)
                        } else shareKakaoSignRequest(context, it, accountScope, cloudToken)
                    },
                    onAlimtalkSign = {
                        if (OnebizGuestWorkspace.isGuestScope(accountScope)) Toast.makeText(context, OnebizGuestServicePolicy.unavailableReason("전자서명 알림톡"), Toast.LENGTH_LONG).show()
                        else sendOnebizContractSignAlimtalk(context, it, accountScope, cloudToken)
                    },
                    onSigned = { signedContract ->
                        val wasUnsigned = contracts.firstOrNull { it.id == signedContract.id }?.signed == false
                        contracts = contracts.map { if (it.id == signedContract.id) signedContract else it }
                        if (wasUnsigned && signedContract.signed) {
                            Toast.makeText(context, "전자서명 완료 · 체결된 계약서로 이동했습니다.", Toast.LENGTH_SHORT).show()
                        }
                    }
                )
                Tab.PAYMENT -> PaymentScreen(
                    contracts = contracts,
                    businessProfile = businessProfile,
                    onPayment = { id, amount ->
                        contracts = contracts.map {
                            if (it.id == id) it.copy(paidAmount = (it.paidAmount + amount).coerceAtMost(it.amount)) else it
                        }
                    },
                    onPaymentEdit = { id, correctedPaidAmount ->
                        contracts = contracts.map {
                            if (it.id == id) it.copy(paidAmount = correctedPaidAmount.coerceIn(0, it.amount)) else it
                        }
                    },
                    onDelete = { id -> contracts = contracts.map { if (it.id == id) it.copy(paymentHidden = true) else it } },
                    onDebtUpdate = { updated -> contracts = contracts.map { if (it.id == updated.id) updated else it } }
                )
                Tab.MORE -> MoreScreen(
                    businessProfile = businessProfile,
                    guestMode = OnebizGuestWorkspace.isGuestScope(accountScope),
                    onEditBusiness = { showBusinessProfile = true },
                    onNotifications = {
                        if (OnebizGuestWorkspace.isGuestScope(accountScope)) Toast.makeText(context, "로그인 없는 모드에서는 온라인 알림함을 아직 지원하지 않습니다.", Toast.LENGTH_LONG).show()
                        else {
                            documentDestination = "notifications"
                            documentTargetId = ""
                            showDocumentCenter = true
                        }
                    },
                    onNotificationSettings = {
                        if (OnebizGuestWorkspace.isGuestScope(accountScope)) Toast.makeText(context, "로그인 없는 모드에서는 온라인 알림 설정을 아직 지원하지 않습니다.", Toast.LENGTH_LONG).show()
                        else {
                            documentDestination = "settings"
                            documentTargetId = ""
                            showDocumentCenter = true
                        }
                    }
                )
            }
            if (showDispatchRoom) {
                DispatchRoomScreen(
                    onClose = { showDispatchRoom = false },
                    onDispatchAccepted = { item ->
                        schedules = schedules.filterNot { it.id == item.id } + item
                    }
                )
            }
            if (showSchedule) {
                ScheduleScreen(
                    customers = customers,
                    schedules = schedules,
                    quotes = quotes,
                    contracts = contracts,
                    onSchedulesChange = { schedules = it },
                    onOpenDocument = { item ->
                        showSchedule = false
                        if (item.sourceType.startsWith("QUOTE")) {
                            quoteFromSchedule = quotes.firstOrNull { it.id == item.sourceId }
                            tab = Tab.QUOTE
                        } else {
                            editingContract = contracts.firstOrNull { it.id == item.sourceId }
                            tab = Tab.CONTRACT
                        }
                    },
                    onClose = { showSchedule = false }
                )
            }
            if (showEmployeeManager) {
                EmployeeManagementScreen(
                    employees = employees,
                    onEmployeesChange = { employees = it },
                    onClose = { showEmployeeManager = false }
                )
            }
            if (showDocumentCenter) {
                DocumentCenterScreen(
                    userId = accountScope, state = documentCenterState,
                    initialDestination = documentDestination, initialDocumentId = documentTargetId,
                    onClose = { showDocumentCenter = false },
                    onOpenSource = { document ->
                        showDocumentCenter = false
                        tab = if (document.sourceType == "contract") Tab.CONTRACT else Tab.QUOTE
                        Toast.makeText(context, "문서번호 ${document.sourceId}의 원본을 선택해 주세요.", Toast.LENGTH_LONG).show()
                    }
                )
            }
        }
    }

    if (quoteEditor) {
        val originalDraft = editingQuote
        val draftConflict = originalDraft != null && !OnebizSyncPolicy.same(
            quoteToJson(originalDraft), quotes.find { it.id == originalDraft.id }?.let(::quoteToJson)
        )
        QuoteEditorScreen(
            customers = customers,
            nextId = editingQuote?.id ?: copiedQuote?.id ?: nextQuoteId(quotes, contracts),
            initialQuote = editingQuote ?: copiedQuote,
            isCopyMode = copiedQuote != null,
            externalConflict = draftConflict,
            onClose = { quoteEditor = false; editingQuote = null; copiedQuote = null },
            onSave = saveDraft@ { customer, quote ->
                synchronized(OnebizSyncRuntime.lock) {
                if (!OnebizGuestWorkspace.canWrite(context, cloudToken, accountScope) || visibleGeneration != OnebizAccountStorage.generation(context)) {
                    Toast.makeText(context, "최신 자료 확인 중입니다. 입력 내용은 유지되니 잠시 후 다시 저장해 주세요.", Toast.LENGTH_LONG).show()
                    return@saveDraft
                }
                val currentOriginal = originalDraft?.let { original -> loadData(context).quotes.find { it.id == original.id } }
                val changedDuringEdit = originalDraft != null && !OnebizSyncPolicy.same(quoteToJson(originalDraft), currentOriginal?.let(::quoteToJson))
                if (changedDuringEdit) {
                    val currentData = loadData(context)
                    quotes = currentData.quotes
                    Toast.makeText(context, "원본이 다른 기기에서 변경되었습니다. 입력한 내용은 새 견적으로 보관할 수 있습니다.", Toast.LENGTH_LONG).show()
                } else {
                    val saved = if (originalDraft == null && quotes.any { it.id == quote.id }) quote.copy(id = nextQuoteId(quotes, contracts)) else quote
                    customers = upsertCustomer(customers, customer)
                    quotes = if (originalDraft != null) quotes.map { if (it.id == saved.id) saved else it } else quotes + saved
                    saveData(context, customers, quotes, contracts)
                    saveItemPhrases(context, saved.items.map { it.name })
                    quoteEditor = false; editingQuote = null; copiedQuote = null; tab = Tab.QUOTE
                }
                }
            },
            onSaveAsNew = saveDraftCopy@ { customer, quote ->
                synchronized(OnebizSyncRuntime.lock) {
                if (!OnebizGuestWorkspace.canWrite(context, cloudToken, accountScope) || visibleGeneration != OnebizAccountStorage.generation(context)) {
                    Toast.makeText(context, "최신 자료 확인 중입니다. 입력 내용은 유지되니 잠시 후 다시 저장해 주세요.", Toast.LENGTH_LONG).show()
                    return@saveDraftCopy
                }
                val saved = quote.copy(id = nextQuoteId(quotes, contracts), status = "작성중", createdAt = LocalDate.now().toString(), sentAt = "")
                customers = upsertCustomer(customers, customer)
                quotes = quotes + saved
                saveData(context, customers, quotes, contracts)
                saveItemPhrases(context, saved.items.map { it.name })
                quoteEditor = false; editingQuote = null; copiedQuote = null; tab = Tab.QUOTE
                }
            }
        )
    }
    editingContract?.let { contract ->
        ContractEditorDialog(
            contract = contract,
            onDismiss = { editingContract = null },
            onSave = { updated ->
                contracts = contracts.map { if (it.id == updated.id) updated else it }
                editingContract = null
            },
            onPdf = { shareContractPdf(context, it) }
        )
    }

    quoteAwaitingSendConfirmation?.let { quote ->
        AlertDialog(
            onDismissRequest = { quoteAwaitingSendConfirmation = null },
            title = { Text("견적서 발송 확인") },
            text = { Text("${quote.customer} 고객에게 견적서 공유를 완료했나요? 완료를 누르면 오늘 날짜로 일정표에 '견적서 발송'이 기록됩니다.") },
            confirmButton = {
                Button(onClick = {
                    quotes = quotes.map { current ->
                        if (current.id == quote.id) current.copy(status = "발송완료", sentAt = LocalDate.now().toString()) else current
                    }
                    quoteAwaitingSendConfirmation = null
                }) { Text("발송 완료") }
            },
            dismissButton = { TextButton(onClick = { quoteAwaitingSendConfirmation = null }) { Text("아직 안 보냈어요") } }
        )
    }

    quoteFromSchedule?.let { quote ->
        QuoteDetailDialog(
            q = quote,
            onDismiss = { quoteFromSchedule = null },
            onPdf = { shareQuotePdf(context, quote) },
            onDelivered = {
                quotes = quotes.map { current ->
                    if (current.id == quote.id) current.copy(status = "발송접수", sentAt = LocalDate.now().toString()) else current
                }
            }
        )
    }

    quoteAlimtalkTarget?.let { quote ->
        QuoteAlimtalkDialog(quote, onDismiss = { quoteAlimtalkTarget = null }, onDelivered = {
            quotes = quotes.map { current ->
                if (current.id == quote.id) current.copy(status = "발송접수", sentAt = LocalDate.now().toString()) else current
            }
        })
    }

    if (addCustomer) {
        AddCustomerDialog(
            onDismiss = { addCustomer = false },
            onSave = { customer ->
                val updatedCustomers = upsertCustomer(customers, customer)
                customers = updatedCustomers
                // 상태 반영을 기다리지 않고 즉시 로컬 저장까지 수행해 등록 누락을 방지한다.
                synchronized(OnebizSyncRuntime.lock) {
                            if (OnebizGuestWorkspace.canWrite(context, cloudToken, accountScope) && visibleGeneration == OnebizAccountStorage.generation(context)) saveData(context, updatedCustomers, quotes, contracts)
                        }
                Toast.makeText(context, "고객 등록 완료", Toast.LENGTH_SHORT).show()
                addCustomer = false
                tab = Tab.CUSTOMER
            }
        )
    }


    if (showBusinessProfile) {
        BusinessProfileDialog(
            initial = businessProfile,
            mustComplete = !businessProfile.isReady,
            onDismiss = { if (businessProfile.isReady) showBusinessProfile = false },
            onRecoveryComplete = { showBusinessProfile = false },
            onSave = { profile ->
                val saved = synchronized(OnebizSyncRuntime.lock) {
                    if (OnebizGuestWorkspace.canWrite(context, cloudToken, accountScope) && visibleGeneration == OnebizAccountStorage.generation(context)) {
                        saveBusinessProfile(context, profile)
                        true
                    } else false
                }
                if (saved) {
                    businessProfile = profile
                    showBusinessProfile = false
                    Toast.makeText(context, if (profile.isBusiness) "사업자 정보와 주업종이 저장되었습니다."
                        else "개인·프리랜서 정보가 사업자등록번호 없이 저장되었습니다.", Toast.LENGTH_LONG).show()
                } else Toast.makeText(context, "계정 또는 서버 자료가 변경되었습니다. 다시 열어 확인해 주세요.", Toast.LENGTH_LONG).show()
            }
        )
    }
}

@Composable
private fun RowScope.BottomItem(item: Tab, selected: Tab, label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: (Tab) -> Unit) {
    NavigationBarItem(selected = item == selected, onClick = { onClick(item) }, icon = { Icon(icon, null) }, label = { Text(label) }, colors = NavigationBarItemDefaults.colors(indicatorColor = PurpleSoft, selectedIconColor = Purple, selectedTextColor = Purple))
}

@Composable
fun HomeScreen(
    customers: List<Customer>,
    quotes: List<Quote>,
    contracts: List<Contract>,
    schedules: List<ScheduleItem>,
    onNewQuote: () -> Unit,
    onCustomer: () -> Unit,
    onMove: (Tab) -> Unit,
    onDispatch: () -> Unit,
    onEmployee: () -> Unit,
    onSchedule: () -> Unit,
    documentUnreadCount: Int = 0,
    onDocuments: () -> Unit = {},
    onInbox: () -> Unit = {}
) {
    val receivableAmount = contracts.filter { it.signed }.sumOf { (it.amount - it.paidAmount).coerceAtLeast(0) }
    val today = LocalDate.now()
    val todaySchedules = (schedules + documentScheduleItems(quotes, contracts))
        .filter { it.date == today.toString() }
        .sortedWith(compareBy<ScheduleItem> {
            when {
                it.startTime.isNotBlank() -> 0
                it.sourceType == "CONTRACT_WORK" -> 1
                else -> 2
            }
        }.thenBy { it.startTime }.thenBy { it.title })
    var showNews by remember { mutableStateOf(false) }
    val navy = Color(0xFF071F56)
    val blue = Color(0xFF0875EA)

    Column(
        Modifier.fillMaxSize().background(Color.White).verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text("ONEBIZ", fontSize = 26.sp, fontWeight = FontWeight.Black, color = navy)
                Text("  |  원비즈", fontSize = 18.sp, color = Color(0xFF647595))
            }
            IconButton(onClick = onInbox) {
                BadgedBox(badge = { if (documentUnreadCount > 0) Badge { Text(if (documentUnreadCount > 99) "99+" else documentUnreadCount.toString()) } }) {
                    Icon(Icons.Default.NotificationsNone, "문서 알림함 · 미확인 ${documentUnreadCount}건", tint = navy)
                }
            }
        }

        Surface(onClick = onDocuments, color = Color(0xFFEAF4FF), shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, Color(0xFFDCEAFF))) {
            Row(Modifier.fillMaxWidth().padding(15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Default.MarkEmailRead, null, tint = blue, modifier = Modifier.size(28.dp))
                Column(Modifier.weight(1f)) {
                    Text("보낸 문서", fontSize = 16.sp, color = navy, fontWeight = FontWeight.Bold)
                    Text("견적·계약·명세서·영수증 전달과 링크 열림 확인", color = Muted, fontSize = 11.sp)
                }
                Icon(Icons.Default.ChevronRight, "보낸 문서 열기", tint = blue)
            }
        }

        Box(Modifier.fillMaxWidth().height(132.dp)) {
            Column(Modifier.align(Alignment.CenterStart).fillMaxWidth(0.65f)) {
                Text("오늘도 사업을", color = navy, fontSize = 24.sp, fontWeight = FontWeight.Black)
                Text("간편하게 관리하세요", color = blue, fontSize = 23.sp, fontWeight = FontWeight.Black, lineHeight = 29.sp)
            }
            Image(
                painter = painterResource(R.drawable.onebiz_character),
                contentDescription = "원비즈 캐릭터",
                modifier = Modifier.align(Alignment.BottomEnd).size(width = 134.dp, height = 132.dp),
                contentScale = ContentScale.Fit
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OnebizHomeTile("견적서 작성", "빠르고 간편하게", Icons.Default.Description, Color(0xFFF0F7FF), blue, Modifier.weight(1f), onNewQuote)
            OnebizHomeTile("계약서 작성", "계약·전자서명", Icons.Default.EditNote, Color(0xFFECFBF8), Color(0xFF00AF9E), Modifier.weight(1f)) { onMove(Tab.CONTRACT) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OnebizHomeTile("고객 관리", "고객 등록·조회", Icons.Default.Groups, Color(0xFFFFF7EC), Color(0xFFEF762A), Modifier.weight(1f), onCustomer)
            OnebizHomeTile("대금 관리", if (receivableAmount > 0) "미수 ${won(receivableAmount)}" else "입금·미수금", Icons.Default.Payments, Color(0xFFF5F2FF), Color(0xFF713FE6), Modifier.weight(1f)) { onMove(Tab.PAYMENT) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OnebizHomeTile("장비배차", "사다리차·스카이차", Icons.Default.LocalShipping, Color(0xFFEAF5FF), blue, Modifier.weight(1f), onDispatch)
            OnebizHomeTile("직원관리", "직원·근로계약", Icons.Default.Badge, Color(0xFFECFBF7), Color(0xFF00B69D), Modifier.weight(1f), onEmployee)
        }

        HomeScheduleCard(today, todaySchedules, onSchedule)

        Card(
            modifier = Modifier.fillMaxWidth().clickable { showNews = true },
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(14.dp),
            border = BorderStroke(1.dp, Color(0xFFDDE7F5))
        ) {
            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Campaign, null, tint = blue)
                Spacer(Modifier.width(9.dp))
                Column(Modifier.weight(1f)) {
                    Text("원비즈 소식", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = navy)
                    Text("견적·계약 일정 자동 표시", fontSize = 12.sp, color = Color(0xFF65779A), maxLines = 1)
                }
                Icon(Icons.Default.ChevronRight, null, tint = Color(0xFF637698))
            }
        }
    }
    if (showNews) AlertDialog(
        onDismissRequest = { showNews = false },
        title = { Text("원비즈 소식") },
        text = { Text("일정표에서 개인·고객 일정과 견적서 작성·발송 기록, 계약서의 시공예정일을 확인할 수 있습니다.") },
        confirmButton = { TextButton(onClick = { showNews = false }) { Text("확인") } }
    )
}

@Composable
private fun OnebizHomeTile(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    background: Color,
    accent: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Card(
        modifier = modifier.height(102.dp).clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = background),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Icon(icon, null, tint = accent, modifier = Modifier.size(28.dp))
            Text(title, color = Color(0xFF071F56), fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(subtitle, color = Color(0xFF65779A), fontSize = 11.sp, maxLines = 1)
        }
    }
}

@Composable
private fun HomeScheduleCard(today: LocalDate, todaySchedules: List<ScheduleItem>, onClick: () -> Unit) {
    val dayName = listOf("일", "월", "화", "수", "목", "금", "토")[today.dayOfWeek.value % 7]
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF4F9FF)),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, Color(0xFFDCEAFF))
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(color = Color(0xFFE1F0FF), shape = RoundedCornerShape(11.dp)) {
                    Icon(Icons.Default.CalendarMonth, null, tint = Color(0xFF0875EA), modifier = Modifier.padding(8.dp).size(26.dp))
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("일정표", color = Color(0xFF071F56), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Text("개인·고객 일정과 견적·계약 일정을 확인하세요.", color = Color(0xFF65779A), fontSize = 11.sp,
                        maxLines = 2)
                }
            }
            HorizontalDivider(Modifier.padding(top = 13.dp, bottom = 9.dp), color = Color(0xFFDCEAFF))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("오늘 일정", color = Color(0xFF071F56), fontSize = 15.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f))
                Text("${today.monthValue}월 ${today.dayOfMonth}일 ${dayName}요일 · ${todaySchedules.size}건",
                    color = Color(0xFF65779A), fontSize = 11.sp)
            }
            if (todaySchedules.isEmpty()) {
                Text("오늘 예정된 일정이 없습니다.", modifier = Modifier.fillMaxWidth().padding(vertical = 15.dp),
                    color = Color(0xFF65779A), fontSize = 13.sp, textAlign = TextAlign.Center)
            } else {
                todaySchedules.take(2).forEach { item ->
                    val category = when (item.sourceType) {
                        "CONTRACT_WORK" -> "시공"
                        "QUOTE_CREATED", "QUOTE_SENT" -> "견적"
                        else -> if (item.type == "PERSONAL") "개인" else "고객"
                    }
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(item.startTime.ifBlank { if (category == "시공") "종일" else "기록" },
                            color = Color(0xFF0875EA), fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.width(48.dp))
                        Column(Modifier.weight(1f)) {
                            Text(listOf(item.customerName, item.title).filter { it.isNotBlank() }.joinToString(" · "),
                                color = Color(0xFF071F56), fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                            val detail = item.address.ifBlank { item.note }
                            if (detail.isNotBlank()) Text(detail, color = Color(0xFF65779A), fontSize = 11.sp, maxLines = 1)
                        }
                        Spacer(Modifier.width(6.dp))
                        Surface(color = if (category == "시공") Color(0xFFE5F6EE) else Color(0xFFEDE8FF),
                            shape = RoundedCornerShape(6.dp)) {
                            Text(category, modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
                                color = if (category == "시공") Color(0xFF16825E) else Color(0xFF5B43D6), fontSize = 10.sp)
                        }
                    }
                    HorizontalDivider(color = Color(0xFFE5EDF8))
                }
                if (todaySchedules.size > 2) Text("그 외 ${todaySchedules.size - 2}건", color = Color(0xFF65779A),
                    fontSize = 11.sp, modifier = Modifier.fillMaxWidth().padding(top = 5.dp), textAlign = TextAlign.End)
            }
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = onClick,
                modifier = Modifier.fillMaxWidth().height(38.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0875EA)),
                shape = RoundedCornerShape(9.dp)
            ) { Text("전체 일정표 보기", fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun LadderTruckMark(
    modifier: Modifier = Modifier,
    tint: Color = Color(0xFF1769E0)
) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val stroke = (w.coerceAtMost(h) * 0.08f).coerceAtLeast(2f)

        // truck body/cab
        drawRoundRect(
            color = tint,
            topLeft = Offset(w * 0.12f, h * 0.55f),
            size = androidx.compose.ui.geometry.Size(w * 0.58f, h * 0.22f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(w * 0.05f, w * 0.05f)
        )
        drawRoundRect(
            color = tint,
            topLeft = Offset(w * 0.58f, h * 0.42f),
            size = androidx.compose.ui.geometry.Size(w * 0.22f, h * 0.35f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(w * 0.04f, w * 0.04f)
        )

        // ladder rails
        val start1 = Offset(w * 0.28f, h * 0.52f)
        val end1 = Offset(w * 0.78f, h * 0.12f)
        val start2 = Offset(w * 0.35f, h * 0.57f)
        val end2 = Offset(w * 0.85f, h * 0.17f)
        drawLine(tint, start1, end1, strokeWidth = stroke, cap = StrokeCap.Round)
        drawLine(tint, start2, end2, strokeWidth = stroke, cap = StrokeCap.Round)

        // ladder rungs
        for (i in 0..4) {
            val t = i / 4f
            val ax = start1.x + (end1.x - start1.x) * t
            val ay = start1.y + (end1.y - start1.y) * t
            val bx = start2.x + (end2.x - start2.x) * t
            val by = start2.y + (end2.y - start2.y) * t
            drawLine(tint, Offset(ax, ay), Offset(bx, by), strokeWidth = stroke * 0.55f, cap = StrokeCap.Round)
        }

        // wheels
        drawCircle(tint, radius = w * 0.09f, center = Offset(w * 0.30f, h * 0.80f))
        drawCircle(tint, radius = w * 0.09f, center = Offset(w * 0.68f, h * 0.80f))
        drawCircle(Color.White, radius = w * 0.035f, center = Offset(w * 0.30f, h * 0.80f))
        drawCircle(Color.White, radius = w * 0.035f, center = Offset(w * 0.68f, h * 0.80f))
    }
}

@Composable
private fun LadderTruckHomeTile(
    title: String,
    sub: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Card(
        modifier = modifier.height(148.dp).clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF4F7FF)),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, Color(0xFFDCE6FA))
    ) {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Surface(shape = RoundedCornerShape(15.dp), color = Color(0xFFE7F0FF)) {
                LadderTruckMark(Modifier.padding(7.dp).size(40.dp))
            }
            Spacer(Modifier.height(6.dp))
            Text(title, fontWeight = FontWeight.Black, fontSize = 16.sp, textAlign = TextAlign.Center)
            Spacer(Modifier.height(2.dp))
            Text(
                sub,
                color = Muted,
                fontSize = 11.sp,
                lineHeight = 14.sp,
                textAlign = TextAlign.Center,
                maxLines = 2
            )
        }
    }
}

@Composable
private fun HomeMenuTile(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    background: Color,
    modifier: Modifier = Modifier,
    tileHeight: androidx.compose.ui.unit.Dp = 132.dp,
    onClick: () -> Unit
) {
    Card(
        modifier = modifier.height(tileHeight).clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = background),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, Color(0xFFF0F2F6))
    ) {
        Column(
            Modifier.fillMaxSize().padding(12.dp),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Surface(shape = RoundedCornerShape(15.dp), color = Color.White) {
                Icon(icon, null, tint = Color(0xFF0B71E8), modifier = Modifier.padding(10.dp).size(29.dp))
            }
            Text(title, fontWeight = FontWeight.Black, fontSize = 15.sp, textAlign = TextAlign.Center, maxLines = 1, color = Color(0xFF0F234A))
            Text(subtitle, color = Color(0xFF687793), fontSize = 10.sp, textAlign = TextAlign.Center, maxLines = 2)
        }
    }
}


@Composable
fun EmployeeManagementScreen(
    employees: List<Employee>,
    onEmployeesChange: (List<Employee>) -> Unit,
    onClose: () -> Unit
) {
    var selectedId by remember { mutableStateOf<String?>(null) }
    var showAdd by remember { mutableStateOf(false) }
    var section by remember { mutableStateOf("기본정보") }
    val selected = employees.firstOrNull { it.id == selectedId }

    Surface(Modifier.fillMaxSize(), color = Bg) {
        if (selected == null) {
            Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onClose) { Icon(Icons.Default.ArrowBack, "뒤로") }
                    Text("직원 관리", fontSize = 26.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f))
                    Button(onClick = { showAdd = true }) { Text("+ 직원 추가") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    EmployeeCountCard("전체", employees.size, Modifier.weight(1f))
                    EmployeeCountCard("근무중", employees.count { it.status == "근무중" }, Modifier.weight(1f))
                    EmployeeCountCard("퇴사", employees.count { it.status == "퇴사" }, Modifier.weight(1f))
                }
                if (employees.isEmpty()) {
                    Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(18.dp)) {
                        Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.Groups, null, tint = Purple, modifier = Modifier.size(52.dp))
                            Spacer(Modifier.height(12.dp))
                            Text("등록된 직원이 없습니다.", fontWeight = FontWeight.Bold)
                            Text("직원 추가부터 시작해 주세요.", color = Muted, fontSize = 13.sp)
                        }
                    }
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(9.dp), modifier = Modifier.weight(1f)) {
                        items(employees, key = { it.id }) { e ->
                            Card(
                                modifier = Modifier.fillMaxWidth().clickable { selectedId = e.id; section = "기본정보" },
                                colors = CardDefaults.cardColors(containerColor = Color.White),
                                shape = RoundedCornerShape(16.dp),
                                border = BorderStroke(1.dp, Border)
                            ) {
                                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Surface(shape = CircleShape, color = PurpleSoft) {
                                        Icon(Icons.Default.Person, null, tint = Purple, modifier = Modifier.padding(10.dp))
                                    }
                                    Spacer(Modifier.width(12.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text("${e.name}  ${e.position}", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                        Text(formatMobilePhone(e.phone.filter(Char::isDigit)), color = Muted, fontSize = 13.sp)
                                    }
                                    AssistChip(onClick = {}, label = { Text(e.status) })
                                    Icon(Icons.Default.ChevronRight, null, tint = Muted)
                                }
                            }
                        }
                    }
                }
            }
        } else {
            Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { selectedId = null }) { Icon(Icons.Default.ArrowBack, "뒤로") }
                    Column(Modifier.weight(1f)) {
                        Text("직원 상세정보", fontSize = 24.sp, fontWeight = FontWeight.Black)
                        Text("${selected.name} · ${selected.position}", color = Muted)
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    listOf("기본정보", "근로계약서", "급여관리", "업무현황").forEach { s ->
                        FilterChip(selected = section == s, onClick = { section = s }, label = { Text(s, fontSize = 11.sp) })
                    }
                }

                when (section) {
                    "기본정보" -> EmployeeBasicSection(selected) { updated ->
                        onEmployeesChange(employees.map { if (it.id == updated.id) updated else it })
                    }
                    "근로계약서" -> EmployeeContractSection(selected) { updated ->
                        onEmployeesChange(employees.map { if (it.id == updated.id) updated else it })
                    }
                    "급여관리" -> EmployeePayrollSection(selected) { updated ->
                        onEmployeesChange(employees.map { if (it.id == updated.id) updated else it })
                    }
                    else -> EmployeeWorkSummary(selected)
                }
            }
        }
    }

    if (showAdd) {
        EmployeeEditDialog(
            initial = null,
            onDismiss = { showAdd = false },
            onSave = { e ->
                onEmployeesChange(employees + e)
                showAdd = false
            }
        )
    }
}

@Composable
private fun EmployeeCountCard(label: String, value: Int, modifier: Modifier = Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(14.dp)) {
        Column(Modifier.padding(13.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value.toString(), fontSize = 22.sp, fontWeight = FontWeight.Black, color = Purple)
            Text(label, color = Muted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun EmployeeBasicSection(employee: Employee, onUpdate: (Employee) -> Unit) {
    var showEdit by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        EmployeeInfoCard("이름", employee.name)
        EmployeeInfoCard("휴대폰", formatMobilePhone(employee.phone.filter(Char::isDigit)))
        EmployeeInfoCard("직책", employee.position)
        EmployeeInfoCard("입사일", employee.joinDate)
        EmployeeInfoCard("근무상태", employee.status)
        if (employee.fullAddress.isNotBlank()) EmployeeInfoCard("주소", employee.fullAddress)
        Button(onClick = { showEdit = true }, modifier = Modifier.fillMaxWidth()) { Text("직원 정보 수정") }
    }
    if (showEdit) EmployeeEditDialog(initial = employee, onDismiss = { showEdit = false }, onSave = { onUpdate(it); showEdit = false })
}

@Composable
private fun EmployeeInfoCard(label: String, value: String) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, Border)) {
        Row(Modifier.fillMaxWidth().padding(14.dp)) {
            Text(label, color = Muted, modifier = Modifier.width(95.dp))
            Text(value.ifBlank { "-" }, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun EmployeeDateField(label: String, value: String, onValueChange: (String) -> Unit) {
    val context = LocalContext.current
    OutlinedTextField(value=value,onValueChange={},readOnly=true,label={Text(label)},modifier=Modifier.fillMaxWidth(),singleLine=true,trailingIcon={IconButton(onClick={val b=runCatching{LocalDate.parse(value)}.getOrDefault(LocalDate.now());DatePickerDialog(context,{_,y,m,d->onValueChange(LocalDate.of(y,m+1,d).toString())},b.year,b.monthValue-1,b.dayOfMonth).show()}){Icon(Icons.Default.CalendarMonth,"달력")}})
}

@Composable
private fun EmployeeMonthField(label: String, value: String, onValueChange: (String) -> Unit) {
    val context=LocalContext.current
    OutlinedTextField(value=value,onValueChange={},readOnly=true,label={Text(label)},modifier=Modifier.fillMaxWidth(),singleLine=true,trailingIcon={IconButton(onClick={val p=value.split("-");val y=p.getOrNull(0)?.toIntOrNull()?:LocalDate.now().year;val m=p.getOrNull(1)?.toIntOrNull()?:LocalDate.now().monthValue;DatePickerDialog(context,{_,yy,mm,_->onValueChange("%04d-%02d".format(yy,mm+1))},y,m-1,1).show()}){Icon(Icons.Default.CalendarMonth,"급여월")}})
}

@Composable
private fun EmployeeMoneyField(label:String,digits:String,onDigitsChange:(String)->Unit){
 val shown=digits.toLongOrNull()?.let{NumberFormat.getNumberInstance(Locale.KOREA).format(it)}?:""
 OutlinedTextField(value=shown,onValueChange={onDigitsChange(it.filter(Char::isDigit).take(12))},label={Text(label)},modifier=Modifier.fillMaxWidth(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),singleLine=true,trailingIcon={Text("원",color=Muted)})
}

@Composable
private fun EmployeeEditDialog(initial: Employee?, onDismiss: () -> Unit, onSave: (Employee) -> Unit) {
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var phone by remember { mutableStateOf(initial?.phone?.filter(Char::isDigit) ?: "") }
    var position by remember { mutableStateOf(initial?.position ?: "") }
    var joinDate by remember { mutableStateOf(initial?.joinDate ?: LocalDate.now().toString()) }
    var status by remember { mutableStateOf(initial?.status ?: "근무중") }
    var address by remember { mutableStateOf(initial?.address ?: "") }
    var addressDetail by remember { mutableStateOf(initial?.addressDetail ?: "") }

    Dialog(onDismissRequest = onDismiss) {
        Card(shape = RoundedCornerShape(22.dp), colors = CardDefaults.cardColors(containerColor = Bg)) {
            Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (initial == null) "직원 등록" else "직원 정보 수정", fontSize = 24.sp, fontWeight = FontWeight.Black)
                OutlinedTextField(name, { name = it }, label = { Text("이름 *") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = phone, onValueChange = { phone = it.filter(Char::isDigit).take(11) }, label = { Text("휴대폰번호 *") }, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), visualTransformation = PhoneVisualTransformation, singleLine = true)
                OutlinedTextField(position, { position = it }, label = { Text("직책 *") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                EmployeeDateField("입사일", joinDate) { joinDate = it }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("근무중", "퇴사").forEach { s -> FilterChip(selected = status == s, onClick = { status = s }, label = { Text(s) }) }
                }
                AddressAutocompleteField(value = address, onValueChange = { address = it }, label = "주소")
                OutlinedTextField(addressDetail, { addressDetail = it }, label = { Text("상세주소") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("취소") }
                    Button(
                        onClick = {
                            if (name.isNotBlank() && phone.length >= 10 && position.isNotBlank()) {
                                onSave((initial ?: Employee(name=name, phone=phone, position=position, joinDate=joinDate)).copy(
                                    name=name.trim(), phone=phone, position=position.trim(), joinDate=joinDate,
                                    status=status, address=address.trim(), addressDetail=addressDetail.trim()
                                ))
                            }
                        },
                        modifier = Modifier.weight(1f),
                        enabled = name.isNotBlank() && phone.length >= 10 && position.isNotBlank()
                    ) { Text("저장") }
                }
            }
        }
    }
}

@Composable
private fun EmployeeContractSection(employee: Employee, onUpdate: (Employee) -> Unit) {
    var terms by remember(employee.id) { mutableStateOf(employee.employmentTerms.ifBlank { defaultEmploymentContractTerms() }) }
    var showAlimtalk by remember { mutableStateOf(false) }
    var start by remember(employee.id) { mutableStateOf(employee.contractStart.ifBlank { employee.joinDate }) }
    var end by remember(employee.id) { mutableStateOf(employee.contractEnd) }
    var workplace by remember(employee.id) { mutableStateOf(employee.workplace) }
    var duty by remember(employee.id) { mutableStateOf(employee.duty) }
    var hours by remember(employee.id) { mutableStateOf(employee.workHours) }
    var breakTime by remember(employee.id) { mutableStateOf(employee.breakTime) }
    var base by remember(employee.id) { mutableStateOf(if (employee.baseSalary == 0) "" else employee.baseSalary.toString()) }
    var allowance by remember(employee.id) { mutableStateOf(if (employee.allowance == 0) "" else employee.allowance.toString()) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("근로계약서", fontSize = 20.sp, fontWeight = FontWeight.Black)
        Text("직원 기본정보는 자동으로 사용합니다.", color = Muted, fontSize = 12.sp)
        EmployeeDateField("계약 시작일", start) { start = it }
        EmployeeDateField("계약 종료일", end) { end = it }
        AddressAutocompleteField(value = workplace, onValueChange = { workplace = it }, label = "근무장소 주소")
        OutlinedTextField(duty, { duty = it }, label = { Text("업무내용") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(hours, { hours = it }, label = { Text("근무시간") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(breakTime, { breakTime = it }, label = { Text("휴게시간") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        EmployeeMoneyField("기본급", base) { base = it }
        EmployeeMoneyField("기타수당", allowance) { allowance = it }

        Text("표준근로계약서", fontSize = 18.sp, fontWeight = FontWeight.Black)
        Text("표준 내용을 기본으로 제공하며 필요하면 직접 수정할 수 있습니다.", color = Muted, fontSize = 12.sp)
        OutlinedTextField(value=terms,onValueChange={terms=it},label={Text("근로계약서 내용")},modifier=Modifier.fillMaxWidth(),minLines=8)

        Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, Border)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("계약서 미리보기", fontWeight = FontWeight.Black)
                Text("근로자: ${employee.name} (${employee.position})", fontSize = 13.sp)
                Text("계약기간: ${start.ifBlank { "-" }} ~ ${end.ifBlank { "기간의 정함 없음" }}", fontSize = 13.sp)
                Text("근무장소: ${workplace.ifBlank { "-" }}", fontSize = 13.sp)
                Text("업무내용: ${duty.ifBlank { "-" }}", fontSize = 13.sp)
                Text("근무시간: ${hours.ifBlank { "-" }} / 휴게 ${breakTime.ifBlank { "-" }}", fontSize = 13.sp)
                Text("임금: 기본급 ${won(base.toIntOrNull() ?: 0)} + 기타수당 ${won(allowance.toIntOrNull() ?: 0)}", fontSize = 13.sp)
            }
        }

        Button(
            onClick = {
                onUpdate(employee.copy(
                    contractStart=start, contractEnd=end, workplace=workplace, duty=duty,
                    workHours=hours, breakTime=breakTime, baseSalary=base.toIntOrNull() ?: 0,
                    allowance=allowance.toIntOrNull() ?: 0, employmentTerms=terms, contractSigned=false
                ))
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("근로계약서 초안 저장") }
        Text("초안 저장은 계약 체결로 처리되지 않습니다. 서명된 계약서를 별도로 확인해 주세요.", color = Muted, fontSize = 12.sp)
        OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) { Text("근로계약서 알림톡 · 준비 중") }
    }
    if (showAlimtalk) {
        OnebizAlimtalkDialog(
            type = "근로계약서",
            recipientName = employee.name,
            initialPhone = employee.phone,
            initialTitle = "[ONEBIZ] 근로계약서 안내",
            initialMessage = "${employee.name}님, 근로계약서 확인 및 서명 안내입니다.\n계약기간: ${start.ifBlank { "-" }} ~ ${end.ifBlank { "기간의 정함 없음" }}",
            onDismiss = { showAlimtalk = false }
        )
    }
}

@Composable
private fun EmployeePayrollSection(employee: Employee, onUpdate: (Employee) -> Unit) {
    var showAlimtalk by remember { mutableStateOf(false) }
    var month by remember(employee.id) { mutableStateOf(employee.lastPayrollMonth.ifBlank { LocalDate.now().toString().take(7) }) }
    var base by remember(employee.id) { mutableStateOf(if (employee.baseSalary == 0) "" else employee.baseSalary.toString()) }
    var allowance by remember(employee.id) { mutableStateOf(if (employee.allowance == 0) "" else employee.allowance.toString()) }
    var meal by remember(employee.id) { mutableStateOf(if (employee.mealAllowance == 0) "" else employee.mealAllowance.toString()) }
    var bonus by remember(employee.id) { mutableStateOf(if (employee.bonus == 0) "" else employee.bonus.toString()) }
    var deductions by remember(employee.id) { mutableStateOf(if (employee.deductions == 0) "" else employee.deductions.toString()) }

    val gross = (base.toIntOrNull() ?: 0) + (allowance.toIntOrNull() ?: 0) + (meal.toIntOrNull() ?: 0) + (bonus.toIntOrNull() ?: 0)
    val net = (gross - (deductions.toIntOrNull() ?: 0)).coerceAtLeast(0)

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("급여관리", fontSize = 20.sp, fontWeight = FontWeight.Black)
        EmployeeMonthField("급여월", month) { month = it }
        EmployeeMoneyField("기본급", base) { base = it }
        EmployeeMoneyField("기타수당", allowance) { allowance = it }
        EmployeeMoneyField("식대", meal) { meal = it }
        EmployeeMoneyField("상여금", bonus) { bonus = it }
        EmployeeMoneyField("공제금액", deductions) { deductions = it }

        Card(colors = CardDefaults.cardColors(containerColor = PurpleSoft), shape = RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(16.dp)) {
                Text("급여명세서", fontWeight = FontWeight.Black, fontSize = 18.sp)
                Text("지급총액  ${won(gross)}", fontSize = 15.sp)
                Text("공제총액  ${won(deductions.toIntOrNull() ?: 0)}", fontSize = 15.sp)
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                Text("실지급액  ${won(net)}", color = Purple, fontSize = 24.sp, fontWeight = FontWeight.Black)
            }
        }

        Button(
            onClick = {
                onUpdate(employee.copy(
                    baseSalary=base.toIntOrNull() ?: 0, allowance=allowance.toIntOrNull() ?: 0,
                    mealAllowance=meal.toIntOrNull() ?: 0, bonus=bonus.toIntOrNull() ?: 0,
                    deductions=deductions.toIntOrNull() ?: 0, lastPayrollMonth=month, payrollPaid=true
                ))
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("급여 저장 · 지급완료") }
        OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) { Text("급여명세서 알림톡 · 준비 중") }
    }
    if (showAlimtalk) {
        OnebizAlimtalkDialog(
            type = "급여명세서",
            recipientName = employee.name,
            initialPhone = employee.phone,
            initialTitle = "[ONEBIZ] 급여명세서 안내",
            initialMessage = "${employee.name}님, ${month} 급여명세서 안내입니다.\n지급총액: ${won(gross)}\n공제총액: ${won(deductions.toIntOrNull() ?: 0)}\n실지급액: ${won(net)}",
            onDismiss = { showAlimtalk = false }
        )
    }
}

@Composable
private fun SalaryNumberField(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value=value, onValueChange={ onChange(it.filter(Char::isDigit)) },
        label={ Text(label) }, modifier=Modifier.fillMaxWidth(),
        keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number), singleLine=true,
        trailingIcon={ Text("원", color=Muted) }
    )
}

@Composable
private fun EmployeeWorkSummary(employee: Employee) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("업무현황", fontSize = 20.sp, fontWeight = FontWeight.Black)
        Text("복잡한 권한설정은 제외하고 직원별 업무 기록 확인에 집중합니다.", color = Muted, fontSize = 12.sp)
        EmployeeInfoCard("근로계약서", if (employee.contractSigned) "기존 체결기록 · 서명 확인 필요" else if (employee.contractStart.isNotBlank() || employee.workplace.isNotBlank()) "초안 작성" else "미작성")
        EmployeeInfoCard("최근 급여", employee.lastPayrollMonth.ifBlank { "미등록" })
        EmployeeInfoCard("급여상태", if (employee.payrollPaid) "지급완료" else "미지급")
        EmployeeInfoCard("근무상태", employee.status)
    }
}

private fun nextHalfHourTime(): String {
    val now = LocalTime.now()
    val totalMinutes = now.hour * 60 + now.minute
    val next = ((totalMinutes + 29) / 30) * 30
    val normalized = next % (24 * 60)
    return "%02d:%02d".format(Locale.US, normalized / 60, normalized % 60)
}

private fun displayDispatchArrivalTime(value: String): String {
    val parts = value.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull() ?: return value
    val minute = parts.getOrNull(1)?.toIntOrNull() ?: return value
    val period = if (hour < 12) "오전" else "오후"
    val h12 = when (val h = hour % 12) { 0 -> 12; else -> h }
    return "$period %02d:%02d".format(Locale.US, h12, minute)
}

@Composable
private fun DispatchArrivalTimeField(
    value: String,
    onValueChange: (String) -> Unit
) {
    val context = LocalContext.current
    val openPicker = {
        val parts = value.split(":")
        val suggested = nextHalfHourTime().split(":")
        val hour = parts.getOrNull(0)?.toIntOrNull()?.coerceIn(0, 23)
            ?: suggested.getOrNull(0)?.toIntOrNull()
            ?: LocalTime.now().hour
        val minute = parts.getOrNull(1)?.toIntOrNull()?.coerceIn(0, 59)
            ?: suggested.getOrNull(1)?.toIntOrNull()
            ?: LocalTime.now().minute
        TimePickerDialog(
            context,
            { _, selectedHour, selectedMinute ->
                onValueChange("%02d:%02d".format(Locale.US, selectedHour, selectedMinute))
            },
            hour,
            minute,
            DateFormat.is24HourFormat(context)
        ).show()
    }

    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = displayDispatchArrivalTime(value),
            onValueChange = {},
            readOnly = true,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("대략적 도착시간 *") },
            placeholder = { Text("시간을 선택하세요") },
            leadingIcon = { Icon(Icons.Default.Schedule, null) },
            trailingIcon = {
                IconButton(onClick = openPicker) {
                    Icon(Icons.Default.AccessTime, "시간 선택")
                }
            },
            supportingText = { Text("현장 도착 예정 시간을 선택해 주세요. 30분 단위 선택을 권장합니다.") },
            singleLine = true
        )
        Box(
            modifier = Modifier
                .matchParentSize()
                .clickable(onClick = openPicker)
        )
    }
}

@Composable
private fun DispatchUseDateField(
    value: String,
    onValueChange: (String) -> Unit
) {
    val context = LocalContext.current
    val openPicker = {
        val base = runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now().plusDays(2))
        DatePickerDialog(
            context,
            { _, year, month, day ->
                onValueChange(LocalDate.of(year, month + 1, day).toString())
            },
            base.year,
            base.monthValue - 1,
            base.dayOfMonth
        ).show()
    }

    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("사용일 *") },
            placeholder = { Text("날짜를 선택하세요") },
            leadingIcon = { Icon(Icons.Default.CalendarMonth, null) },
            trailingIcon = {
                IconButton(onClick = openPicker) {
                    Icon(Icons.Default.CalendarMonth, "달력 열기")
                }
            },
            singleLine = true
        )
        Box(
            modifier = Modifier
                .matchParentSize()
                .clickable(onClick = openPicker)
        )
    }
}

private fun dispatchFloorLimit(equipment: String): Int = when (equipment) {
    "사다리차" -> 20
    "스카이차", "크레인" -> 10
    else -> 10
}

private fun dispatchFloorLabel(equipment: String, floorLevel: Int): String {
    val limit = dispatchFloorLimit(equipment)
    return if (floorLevel >= limit) "${limit}층 이상" else "${floorLevel}층"
}

@Composable
private fun DispatchFloorSelector(
    equipment: String,
    floorLevel: Int,
    onFloorChange: (Int) -> Unit
) {
    val limit = dispatchFloorLimit(equipment)
    var floorMenuExpanded by remember(equipment) { mutableStateOf(false) }
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        border = BorderStroke(1.dp, Border),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("층수 *", color = Muted, fontSize = 13.sp)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(
                    onClick = { onFloorChange((floorLevel - 1).coerceAtLeast(1)) },
                    enabled = floorLevel > 1
                ) {
                    Icon(Icons.Default.RemoveCircleOutline, "층수 내리기")
                }
                Box(modifier = Modifier.weight(1f)) {
                    TextButton(
                        onClick = { floorMenuExpanded = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            dispatchFloorLabel(equipment, floorLevel),
                            textAlign = TextAlign.Center,
                            color = if (floorLevel >= limit) Color(0xFFD86800) else Text,
                            fontSize = 25.sp,
                            fontWeight = FontWeight.Black
                        )
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Default.ArrowDropDown, "층수 목록 열기")
                    }
                    DropdownMenu(
                        expanded = floorMenuExpanded,
                        onDismissRequest = { floorMenuExpanded = false },
                        modifier = Modifier.heightIn(max = 320.dp)
                    ) {
                        (1..limit).forEach { level ->
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        dispatchFloorLabel(equipment, level),
                                        fontWeight = if (level == floorLevel) FontWeight.Black else FontWeight.Normal
                                    )
                                },
                                onClick = {
                                    onFloorChange(level)
                                    floorMenuExpanded = false
                                }
                            )
                        }
                    }
                }
                IconButton(
                    onClick = { onFloorChange((floorLevel + 1).coerceAtMost(limit)) },
                    enabled = floorLevel < limit
                ) {
                    Icon(Icons.Default.AddCircleOutline, "층수 올리기")
                }
            }
            Text(
                if (equipment == "사다리차") "숫자를 눌러 1층부터 20층 이상까지 바로 선택할 수 있습니다."
                else "숫자를 눌러 1층부터 10층 이상까지 바로 선택할 수 있습니다.",
                color = Muted,
                fontSize = 12.sp,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center
            )
        }
    }
}

data class OnebizDispatchHistoryItem(
    val id: String,
    val equipment: String,
    val date: String,
    val arrivalTime: String,
    val address: String,
    val phone: String,
    val floor: String,
    val goods: String,
    val minutes: Int,
    val estimatedAmount: Int,
    val status: String
)

fun fetchOnebizDispatchHistory(context: Context, onResult: (List<OnebizDispatchHistoryItem>) -> Unit) {
    val token = onebizCloudToken(context)
    if (token.isBlank()) { onResult(emptyList()); return }
    Thread {
        val (ok, _, body) = onebizCloudRequest("GET", "/api/dispatch", token = token)
        val list = if (!ok) emptyList() else runCatching {
            val arr = JSONObject(body).optJSONArray("items") ?: JSONArray()
            (0 until arr.length()).mapNotNull { index ->
                val o = arr.optJSONObject(index) ?: return@mapNotNull null
                OnebizDispatchHistoryItem(
                    id = o.optString("id"), equipment = o.optString("equipment"),
                    date = o.optString("date"), arrivalTime = o.optString("arrivalTime"),
                    address = o.optString("address"), phone = o.optString("phone"),
                    floor = o.optString("floor"), goods = o.optString("goods"),
                    minutes = o.optInt("minutes", 30), estimatedAmount = o.optInt("estimatedAmount", 0),
                    status = o.optString("status", "접수대기")
                )
            }
        }.getOrDefault(emptyList())
        Handler(Looper.getMainLooper()).post { onResult(list) }
    }.start()
}

@Composable
fun DispatchRoomScreen(onClose: () -> Unit, onDispatchAccepted: (ScheduleItem) -> Unit) {
    val context = LocalContext.current
    var equipment by remember { mutableStateOf("사다리차") }
    var address by remember { mutableStateOf("") }
    var useDate by remember { mutableStateOf(LocalDate.now().plusDays(2).toString()) }
    var arrivalTime by remember { mutableStateOf("") }
    var floorLevel by remember { mutableStateOf(1) }
    var controlRoomConfirmed by remember { mutableStateOf(false) }
    var cargo by remember { mutableStateOf("") }
    var durationUnits by remember { mutableStateOf(1) } // 30분 단위
    var phone by remember { mutableStateOf("") }
    var dispatchHistory by remember { mutableStateOf<List<OnebizDispatchHistoryItem>>(emptyList()) }
    var receiptMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        fetchOnebizDispatchHistory(context) { dispatchHistory = it }
    }

    val base = when (equipment) {
        "사다리차" -> 60000
        "스카이차" -> 150000
        else -> 0
    }
    val extra = when (equipment) {
        "사다리차" -> 25000
        "스카이차" -> 100000
        else -> 0
    }
    val total = if (equipment == "크레인") 0 else base + ((durationUnits - 1).coerceAtLeast(0) * extra)
    val floorLimit = dispatchFloorLimit(equipment)
    val requiresControlRoom = floorLevel >= floorLimit
    val floor = dispatchFloorLabel(equipment, floorLevel)

    Surface(Modifier.fillMaxSize(), color = Bg) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Default.ArrowBack, null) }
                Column(Modifier.weight(1f)) {
                    Text("장비배차방", fontSize = 28.sp, fontWeight = FontWeight.Black)
                    Text("사다리차 · 스카이차 · 크레인 배차 신청", color = Muted)
                }
            }

            Card(colors = CardDefaults.cardColors(containerColor = BlueSoft), shape = RoundedCornerShape(22.dp)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("장비를 선택하세요", fontWeight = FontWeight.Black, fontSize = 18.sp)
                    Text("사용시간은 30분 단위로 계산됩니다.", color = Muted, fontSize = 13.sp)
                }
            }

            if (dispatchHistory.isNotEmpty()) {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(20.dp)) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("내 배차 신청 현황", fontWeight = FontWeight.Black, fontSize = 17.sp)
                            Text("최근 ${dispatchHistory.size.coerceAtMost(5)}건", color = Muted, fontSize = 12.sp)
                        }
                        dispatchHistory.take(5).forEach { item ->
                            Surface(color = Color(0xFFF8FAFE), shape = RoundedCornerShape(14.dp)) {
                                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("${item.equipment} · ${item.date} ${item.arrivalTime}", fontWeight = FontWeight.Bold)
                                        Status(item.status)
                                    }
                                    Text(item.address, color = Muted, fontSize = 12.sp, maxLines = 2)
                                    Text(listOf(item.floor, item.goods, "${item.minutes}분").filter { it.isNotBlank() }.joinToString(" · "), color = Muted, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("사다리차", "스카이차", "크레인").forEach { name ->
                    FilterChip(
                        selected = equipment == name,
                        onClick = {
                            if (equipment != name) {
                                equipment = name
                                floorLevel = 1
                                controlRoomConfirmed = false
                            }
                        },
                        label = { Text(name) }
                    )
                }
            }

            AddressAutocompleteField(
                value = address,
                onValueChange = { address = it },
                label = "현장 주소 *"
            )
            DispatchUseDateField(
                value = useDate,
                onValueChange = { useDate = it }
            )
            DispatchArrivalTimeField(
                value = arrivalTime,
                onValueChange = { arrivalTime = it }
            )
            DispatchFloorSelector(
                equipment = equipment,
                floorLevel = floorLevel,
                onFloorChange = {
                    floorLevel = it
                    if (it < floorLimit) controlRoomConfirmed = false
                }
            )
            OutlinedTextField(
                value = cargo,
                onValueChange = { cargo = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("물건 종류") },
                singleLine = true
            )

            if (requiresControlRoom) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = OrangeSoft),
                    border = BorderStroke(1.dp, Color(0xFFD86800)),
                    shape = RoundedCornerShape(18.dp)
                ) {
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.SupportAgent, null, tint = Color(0xFFD86800))
                            Spacer(Modifier.width(8.dp))
                            Text("상황실 확인이 필요한 고층 작업입니다", color = Color(0xFF9A4800), fontWeight = FontWeight.Black)
                        }
                        Text(
                            "$equipment ${floorLimit}층 이상은 현장 조건과 장비 진입 가능 여부를 확인한 뒤 배차합니다.",
                            color = Color(0xFF79451B),
                            fontSize = 13.sp
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                checked = controlRoomConfirmed,
                                onCheckedChange = { controlRoomConfirmed = it }
                            )
                            Text("상황실과 통화했습니다.", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(20.dp)) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text("사용시간", fontWeight = FontWeight.Bold); Text("${durationUnits * 30}분", color = Purple, fontSize = 22.sp, fontWeight = FontWeight.Black) }
                    IconButton(onClick = { if (durationUnits > 1) durationUnits-- }) { Icon(Icons.Default.RemoveCircleOutline, null) }
                    IconButton(onClick = { durationUnits++ }) { Icon(Icons.Default.AddCircleOutline, null) }
                }
            }

            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it.filter(Char::isDigit).take(11) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("연락처 *") },
                placeholder = { Text("010-1234-5678") },
                leadingIcon = { Icon(Icons.Default.Phone, null) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                visualTransformation = PhoneVisualTransformation,
                singleLine = true
            )

            Card(colors = CardDefaults.cardColors(containerColor = PurpleSoft), shape = RoundedCornerShape(22.dp)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("예상 요금", fontWeight = FontWeight.Black, fontSize = 18.sp)
                    if (requiresControlRoom) {
                        Text("상황실 통화 후 별도 안내", color = Color(0xFFD86800), fontSize = 22.sp, fontWeight = FontWeight.Black)
                        Text("고층 작업은 현장 여건 확인 후 장비와 요금이 확정됩니다.", color = Muted, fontSize = 13.sp)
                    } else if (equipment == "크레인") {
                        Text("현장 조건 확인 후 별도 견적", color = Purple, fontSize = 22.sp, fontWeight = FontWeight.Black)
                    } else {
                        Text(won(total), color = Purple, fontSize = 30.sp, fontWeight = FontWeight.Black)
                        Text("기본 30분 ${won(base)} · 추가 30분 ${won(extra)}", color = Muted, fontSize = 13.sp)
                    }
                }
            }

            Button(
                onClick = {
                    if (address.isBlank() || useDate.isBlank() || arrivalTime.isBlank() || phone.length < 10) {
                        Toast.makeText(context, "현장 주소·사용일·도착시간·연락처를 확인해 주세요.", Toast.LENGTH_SHORT).show()
                    } else if (requiresControlRoom && !controlRoomConfirmed) {
                        Toast.makeText(context, "상황실과 통화한 뒤 확인 항목을 선택해 주세요.", Toast.LENGTH_LONG).show()
                    } else {
                        submitOnebizDispatch(
                            context = context,
                            equipment = equipment,
                            address = address,
                            useDate = useDate,
                            arrivalTime = arrivalTime,
                            floor = floor,
                            cargo = cargo,
                            durationMinutes = durationUnits * 30,
                            phone = formatMobilePhone(phone),
                            estimatedAmount = if (requiresControlRoom) 0 else total,
                            requiresControlRoom = requiresControlRoom,
                            controlRoomConfirmed = controlRoomConfirmed
                        ) { ok, message ->
                            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
                            if (ok) {
                                val schedule = ScheduleItem(
                                    id = "DISPATCH:${System.currentTimeMillis()}",
                                    type = "CUSTOMER",
                                    title = "장비배차 · $equipment",
                                    date = useDate,
                                    startTime = arrivalTime,
                                    customerPhone = formatMobilePhone(phone),
                                    address = address.trim(),
                                    note = listOf(
                                        "접수대기",
                                        floor,
                                        cargo.trim().takeIf { it.isNotBlank() }?.let { "물건 $it" }.orEmpty(),
                                        "${durationUnits * 30}분",
                                        if (requiresControlRoom || equipment == "크레인") "요금 별도안내" else "예상 ${won(total)}"
                                    ).filter { it.isNotBlank() }.joinToString(" · ")
                                )
                                onDispatchAccepted(schedule)
                                fetchOnebizDispatchHistory(context) { dispatchHistory = it }
                                receiptMessage = message
                            }
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(18.dp)
            ) {
                Icon(Icons.Default.Send, null)
                Spacer(Modifier.width(8.dp))
                Text(if (requiresControlRoom) "상황실 통화 확인 후 배차 신청" else "배차 신청하기", fontWeight = FontWeight.Black)
            }

            Text("초기 운영은 ONEBIZ에서 통합 접수·관리하며 기사 자동배차는 추후 연동할 수 있습니다.", color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(18.dp))
        }
    }

    if (receiptMessage != null) {
        AlertDialog(
            onDismissRequest = { receiptMessage = null },
            title = { Text("배차 접수 완료", fontWeight = FontWeight.Black) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(receiptMessage.orEmpty())
                    Text("$equipment · $useDate ${arrivalTime.ifBlank { "시간 미정" }}", fontWeight = FontWeight.Bold)
                    Text(address, color = Muted)
                    Text("연락처 ${formatMobilePhone(phone)} · $floor · ${durationUnits * 30}분", color = Muted)
                    if (cargo.isNotBlank()) Text("물건 $cargo", color = Muted)
                    Text("일정표에도 자동 등록했습니다.", color = Color(0xFF0875EA), fontWeight = FontWeight.Bold)
                }
            },
            confirmButton = {
                Button(onClick = { receiptMessage = null; onClose() }) { Text("확인") }
            }
        )
    }
}

@Composable
fun StatCard(title: String, value: Int, icon: androidx.compose.ui.graphics.vector.ImageVector, bg: Color, modifier: Modifier, onClick: () -> Unit) {
    Card(modifier.clickable { onClick() }, colors = CardDefaults.cardColors(containerColor = bg), shape = RoundedCornerShape(24.dp)) {
        Column(Modifier.padding(18.dp).height(120.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(verticalAlignment = Alignment.CenterVertically) { Icon(icon, null, tint = Purple); Spacer(Modifier.width(8.dp)); Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp) }
            Text(value.toString(), fontSize = 32.sp, fontWeight = FontWeight.Black)
            Text("현황 확인", color = Muted, fontSize = 13.sp)
        }
    }
}

@Composable
fun QuickCard(title: String, sub: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Card(modifier.clickable { onClick() }, colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(22.dp)) {
        Column(Modifier.padding(18.dp).height(120.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Surface(shape = RoundedCornerShape(14.dp), color = PurpleSoft) { Icon(icon, null, Modifier.padding(10.dp), tint = Purple) }
            Text(title, fontWeight = FontWeight.Black, fontSize = 18.sp); Text(sub, color = Muted, fontSize = 13.sp)
        }
    }
}

@Composable
fun RecentRow(id: String, customer: String, amount: Int, status: String, contract: Boolean) {
    Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = RoundedCornerShape(14.dp), color = if (contract) GreenSoft else BlueSoft) { Icon(if (contract) Icons.Default.EditNote else Icons.Default.Description, null, Modifier.padding(10.dp), tint = if (contract) Color(0xFF14885C) else Color(0xFF2D82C7)) }
        Spacer(Modifier.width(10.dp)); Column(Modifier.weight(1f)) { Text(id, fontWeight = FontWeight.Bold); Text(customer, color = Muted) }
        Column(horizontalAlignment = Alignment.End) { Text(won(amount), fontWeight = FontWeight.Bold); Text(status, color = Purple, fontSize = 12.sp) }
    }
}

@Composable
fun CustomerScreen(
    customers: List<Customer>,
    onAdd: () -> Unit,
    onUpdate: (Customer, Customer) -> Unit,
    onDelete: (Customer) -> Unit
) {
    var q by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<Customer?>(null) }
    var editing by remember { mutableStateOf<Customer?>(null) }
    var deleteTarget by remember { mutableStateOf<Customer?>(null) }
    val filtered = customers.filter { q.isBlank() || it.name.contains(q, true) || it.phone.contains(q) || it.address.contains(q, true) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Header("고객관리", "고객 이름을 누르면 상세정보를 확인·수정할 수 있습니다.")
        Button(onClick = onAdd, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
            Icon(Icons.Default.PersonAdd, null); Spacer(Modifier.width(6.dp)); Text("고객 등록")
        }
        OutlinedTextField(
            q, { q = it }, modifier = Modifier.fillMaxWidth(),
            leadingIcon = { Icon(Icons.Default.Search, null) },
            placeholder = { Text("이름·전화번호·주소 검색") }, singleLine = true
        )
        if (filtered.isEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(18.dp)) {
                Text("검색 결과가 없습니다.", Modifier.padding(18.dp), color = Muted)
            }
        }
        filtered.forEach { c ->
            Card(
                modifier = Modifier.fillMaxWidth().clickable { selected = c },
                colors = CardDefaults.cardColors(containerColor = Color.White),
                border = BorderStroke(1.dp, Border),
                shape = RoundedCornerShape(18.dp)
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 17.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Surface(shape = CircleShape, color = PurpleSoft) {
                        Icon(Icons.Default.Person, null, Modifier.padding(9.dp), tint = Purple)
                    }
                    Spacer(Modifier.width(12.dp))
                    Text(c.name, modifier = Modifier.weight(1f), fontWeight = FontWeight.Black, fontSize = 19.sp)
                    Icon(Icons.Default.ChevronRight, contentDescription = "상세정보", tint = Muted)
                }
            }
        }
    }

    selected?.let { customer ->
        CustomerDetailDialog(
            customer = customer,
            onDismiss = { selected = null },
            onEdit = {
                selected = null
                editing = customer
            },
            onDelete = {
                selected = null
                deleteTarget = customer
            }
        )
    }

    editing?.let { old ->
        AddCustomerDialog(
            onDismiss = { editing = null },
            onSave = { updated ->
                onUpdate(old, updated)
                editing = null
                selected = updated
            },
            initialCustomer = old,
            dialogTitle = "고객정보 수정",
            saveText = "수정 저장"
        )
    }

    deleteTarget?.let { customer ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            icon = { Icon(Icons.Default.DeleteOutline, null, tint = MaterialTheme.colorScheme.error) },
            title = { Text("고객 삭제", fontWeight = FontWeight.Black) },
            text = {
                Text("${customer.name} 고객을 고객관리 목록에서 삭제하시겠습니까?\n\n기존 견적서·계약서 기록은 삭제되지 않습니다.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        onDelete(customer)
                        deleteTarget = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("삭제") }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("취소") } }
        )
    }
}

@Composable
fun CustomerDetailDialog(
    customer: Customer,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(customer.name, fontWeight = FontWeight.Black, fontSize = 24.sp) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                DetailInfoRow(Icons.Default.Phone, "휴대폰", formatMobilePhone(customer.phone))
                DetailInfoRow(Icons.Default.LocationOn, "주소", fullCustomerAddress(customer).ifBlank { "미등록" })
            }
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onDelete,
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) {
                    Icon(Icons.Default.DeleteOutline, null); Spacer(Modifier.width(5.dp)); Text("삭제")
                }
                Button(onClick = onEdit, shape = RoundedCornerShape(14.dp)) {
                    Icon(Icons.Default.Edit, null); Spacer(Modifier.width(5.dp)); Text("수정")
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } }
    )
}

@Composable
fun DetailInfoRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Surface(shape = RoundedCornerShape(12.dp), color = PurpleSoft) {
            Icon(icon, null, Modifier.padding(9.dp), tint = Purple)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(label, color = Muted, fontSize = 13.sp)
            Text(value.ifBlank { "미등록" }, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
internal fun QuoteScreen(
    quotes: List<Quote>,
    contracts: List<Contract>,
    industry: String,
    onNew: () -> Unit,
    onExample: (QuoteExampleDefinition) -> Unit,
    onAlimtalk: (Quote) -> Unit,
    onDelivered: (Quote) -> Unit,
    onKakao: (Quote) -> Unit,
    onPdf: (Quote) -> Unit,
    onCopy: (Quote) -> Unit,
    onEdit: (Quote) -> Unit,
    onDelete: (Quote) -> Unit,
    onContract: (Quote) -> Unit
) {
    var detail by remember { mutableStateOf<Quote?>(null) }
    var deleteTarget by remember { mutableStateOf<Quote?>(null) }
    var quoteFilter by remember { mutableStateOf("전체") }
    var quoteQuery by remember { mutableStateOf("") }
    var showIndustryExamples by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val documentOwnerId = remember { onebizCloudUserId(context) }
    val documentOwnerToken = remember { onebizCloudToken(context) }
    var documentPickerType by remember { mutableStateOf<String?>(null) }
    var expandedQuoteIds by remember { mutableStateOf(setOf<String>()) }
    var documentAlimtalkTarget by remember { mutableStateOf<Pair<Quote, String>?>(null) }
    // PDF 발행은 알림톡과 분리하여 오프라인에서도 공유할 수 있습니다.
    var receiptPdfTarget by remember { mutableStateOf<Quote?>(null) }
    var receiptPdfAmount by remember { mutableStateOf("") }
    var receiptPdfError by remember { mutableStateOf("") }
    var receivedAmountInput by remember { mutableStateOf("") }
    var receivedAmountError by remember { mutableStateOf("") }
    var documentSendError by remember { mutableStateOf("") }
    var documentSendBusy by remember { mutableStateOf(false) }
    val sentStatuses = setOf("발송", "발송완료", "발송접수", "계약완료")
    val visibleQuotes = quotes.filter { q ->
        val matchesFilter = when (quoteFilter) {
            "작성중·미발송" -> q.status !in sentStatuses
            "발송완료" -> q.status in sentStatuses
            else -> true
        }
        val query = quoteQuery.trim()
        val matchesQuery = query.isBlank() || listOf(
            q.id,
            q.customer,
            q.phone,
            fullSiteAddress(q),
            q.items.joinToString(" ") { it.name }
        ).any { it.contains(query, ignoreCase = true) }
        matchesFilter && matchesQuery
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Header("견적서 관리", "새 견적을 만들거나 기존 견적을 이어작성·복사할 수 있습니다.")
        Button(onClick = onNew, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
            Icon(Icons.Default.Add, null)
            Spacer(Modifier.width(6.dp))
            Text("새로운 견적서 만들기", fontWeight = FontWeight.Bold)
        }
        OutlinedButton(onClick = { showIndustryExamples = true }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
            Icon(Icons.Default.ContentCopy, null)
            Spacer(Modifier.width(6.dp))
            Text("업종별 작성 예시 · 복사해서 작성")
        }
        OutlinedTextField(
            value = quoteQuery,
            onValueChange = { quoteQuery = it },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = { Icon(Icons.Default.Search, null) },
            trailingIcon = {
                if (quoteQuery.isNotBlank()) IconButton(onClick = { quoteQuery = "" }) { Icon(Icons.Default.Close, null) }
            },
            label = { Text("기존 견적서 검색") },
            placeholder = { Text("고객명·전화번호·현장주소·견적번호") },
            singleLine = true,
            shape = RoundedCornerShape(16.dp)
        )
        Text("기존 견적서", fontWeight = FontWeight.Black, fontSize = 17.sp)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = quoteFilter == "전체",
                onClick = { quoteFilter = "전체" },
                label = { Text("전체 (${quotes.size})", fontSize = 11.sp) },
                modifier = Modifier
            )
            FilterChip(
                selected = quoteFilter == "작성중·미발송",
                onClick = { quoteFilter = "작성중·미발송" },
                label = { Text("작성중 (${quotes.count { it.status !in sentStatuses }})", fontSize = 11.sp) },
                modifier = Modifier
            )
            FilterChip(
                selected = quoteFilter == "발송완료",
                onClick = { quoteFilter = "발송완료" },
                label = { Text("발송 (${quotes.count { it.status in sentStatuses }})", fontSize = 11.sp) },
                modifier = Modifier
            )
        }
        if (visibleQuotes.isEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(18.dp)) {
                Text(
                    if (quoteQuery.isNotBlank()) "검색 조건에 맞는 견적서가 없습니다." else "아직 저장된 견적서가 없습니다.\n위 버튼을 눌러 첫 견적서를 만들어 보세요.",
                    modifier = Modifier.fillMaxWidth().padding(22.dp),
                    color = Muted,
                    textAlign = TextAlign.Center
                )
            }
        }
        visibleQuotes.reversed().forEach { q ->
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(20.dp)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(q.id, fontWeight = FontWeight.Black); Status(q.status) }
                    Text(q.customer, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                    Text(q.createdAt, color = Muted, fontSize = 12.sp)
                    if (fullSiteAddress(q).isNotBlank()) Text("현장  ${fullSiteAddress(q)}", color = Muted, fontSize = 12.sp, maxLines = 2)
                    Text("${q.items.size}개 품목 · ${q.itemSummary}", color = Muted)
                    Text(won(q.total), fontSize = 24.sp, fontWeight = FontWeight.Black)
                    // Two readable actions + full-width PDF: avoids three clipped buttons on phones.
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { detail = q }, modifier = Modifier.weight(1f)) {
                                Text("미리보기", maxLines = 1)
                            }
                            OutlinedButton(onClick = { onEdit(q) }, modifier = Modifier.weight(1f)) {
                                Text("이어작성", maxLines = 1)
                            }
                        }
                        OutlinedButton(onClick = { onPdf(q) }, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.PictureAsPdf, null)
                            Spacer(Modifier.width(6.dp))
                            Text("PDF 저장·공유")
                        }
                    }
                    val isExpanded = q.id in expandedQuoteIds
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = Color(0xFFF2EEFF),
                        shape = RoundedCornerShape(14.dp),
                        border = BorderStroke(1.dp, Color(0xFFD8CFF7))
                    ) {
                        Column {
                            Row(
                                modifier = Modifier.fillMaxWidth().clickable {
                                    expandedQuoteIds = if (isExpanded) expandedQuoteIds - q.id else expandedQuoteIds + q.id
                                }.padding(horizontal = 14.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Icon(Icons.Default.Apps, null, tint = Purple)
                                    Text("추가 기능", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                                }
                                Icon(if (isExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                                    contentDescription = if (isExpanded) "추가 기능 접기" else "추가 기능 펼치기", tint = Purple)
                            }
                            if (isExpanded) {
                                Column(
                                    modifier = Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, bottom = 12.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        OutlinedButton(
                                            onClick = { documentAlimtalkTarget = q to "거래명세서"; receivedAmountInput = ""; receivedAmountError = ""; documentSendError = "" },
                                            modifier = Modifier.weight(1f),
                                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 9.dp)
                                        ) { Text("거래명세서\n알림톡 보내기", fontSize = 12.sp, lineHeight = 17.sp, textAlign = TextAlign.Center, color = Color(0xFF1767CE)) }
                                        OutlinedButton(
                                            onClick = { documentAlimtalkTarget = q to "간이영수증"; receivedAmountInput = ""; receivedAmountError = ""; documentSendError = "" },
                                            modifier = Modifier.weight(1f),
                                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 9.dp)
                                        ) { Text("간이영수증\n알림톡 보내기", fontSize = 12.sp, lineHeight = 17.sp, textAlign = TextAlign.Center, color = Color(0xFF088B56)) }
                                    }
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        OutlinedButton(
                                            onClick = { shareQuotePaymentDocumentPdf(context, q, "거래명세서") },
                                            modifier = Modifier.weight(1f),
                                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 9.dp)
                                        ) {
                                            Icon(Icons.Default.PictureAsPdf, null, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.width(3.dp))
                                            Text("거래명세서\nPDF 공유하기", fontSize = 12.sp, lineHeight = 17.sp, textAlign = TextAlign.Center)
                                        }
                                        OutlinedButton(
                                            onClick = {
                                                receiptPdfTarget = q
                                                receiptPdfAmount = ""
                                                receiptPdfError = ""
                                            },
                                            modifier = Modifier.weight(1f),
                                            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 9.dp)
                                        ) {
                                            Icon(Icons.Default.PictureAsPdf, null, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.width(3.dp))
                                            Text("간이영수증\nPDF 공유하기", fontSize = 12.sp, lineHeight = 17.sp, textAlign = TextAlign.Center)
                                        }
                                    }
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        OutlinedButton(onClick = { onCopy(q) }, modifier = Modifier.weight(1f),
                                            contentPadding = PaddingValues(horizontal = 5.dp, vertical = 7.dp)) {
                                            Icon(Icons.Default.ContentCopy, null, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.width(3.dp))
                                            Text("복사하기", fontSize = 12.sp)
                                        }
                                        OutlinedButton(onClick = { deleteTarget = q }, modifier = Modifier.weight(1f),
                                            contentPadding = PaddingValues(horizontal = 5.dp, vertical = 7.dp),
                                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                                            Icon(Icons.Default.DeleteOutline, null, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.width(3.dp))
                                            Text("삭제", fontSize = 12.sp)
                                        }
                                    }
                                    Button(
                                        onClick = { onAlimtalk(q) }, modifier = Modifier.fillMaxWidth(),
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFEE500), contentColor = Color(0xFF191919)),
                                        shape = RoundedCornerShape(12.dp)
                                    ) { Icon(Icons.Default.Send, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("카카오 알림톡으로 견적 안내", fontSize = 13.sp) }
                                    OutlinedButton(onClick = { onKakao(q) }, modifier = Modifier.fillMaxWidth()) {
                                        Text("카카오톡으로 견적서 PDF 보내기", fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                    }
                    Button(onClick = { onContract(q) }, modifier = Modifier.fillMaxWidth()) { Text("이 견적으로 계약서 만들기") }
                }
            }
        }
    }
    documentAlimtalkTarget?.let { (quote, docType) ->
        val isReceipt = docType == "간이영수증"
        AlertDialog(
            onDismissRequest = { if (!documentSendBusy) documentAlimtalkTarget = null },
            title = { Text("${docType} 알림톡 보내기", fontWeight = FontWeight.Black) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("견적서: ${quote.id}", fontWeight = FontWeight.Bold)
                    Text("수신 고객: ${quote.customer}")
                    Text("고객번호: ${quote.phone}")
                    Text("견적금액: ${won(quote.total)}")
                    if (isReceipt) {
                        OutlinedTextField(
                            value = receivedAmountInput,
                            onValueChange = { receivedAmountInput = it; receivedAmountError = ""; documentSendError = "" },
                            label = { Text("실제 받은 금액 (원)") },
                            enabled = !documentSendBusy,
                            isError = receivedAmountError.isNotBlank(),
                            supportingText = { if (receivedAmountError.isNotBlank()) Text(receivedAmountError) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Text("금액을 실제로 받았을 때만 간이영수증을 발행하세요.", fontSize = 12.sp, color = Muted)
                    }
                    Text("이 견적서 정보로 문서를 발행하고 고객에게 확인 링크를 알림톡으로 보냅니다. 계약서 선택은 필요 없습니다.", fontSize = 12.sp, color = Muted)
                    if (documentSendBusy) Text("저장·동기화와 발송 가능 여부를 확인하고 있습니다.", fontSize = 12.sp, color = Purple)
                    if (documentSendError.isNotBlank()) Text(documentSendError, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }
            },
            confirmButton = {
                TextButton(enabled = !documentSendBusy, onClick = {
                    val validation = if (isReceipt) validateReceiptAmountInput(receivedAmountInput, quote.total.toLong()) else ReceiptAmountInputResult(0L)
                    receivedAmountError = validation.error
                    documentSendError = ""
                    if (validation.value != null) {
                        documentSendBusy = true
                        sendPaymentDocumentAlimtalk(context, quote, docType, validation.value, documentOwnerId, documentOwnerToken) { accepted, message ->
                            documentSendBusy = false
                            if (accepted) {
                                documentAlimtalkTarget = null
                                Toast.makeText(context, message, Toast.LENGTH_LONG).show()
                            } else documentSendError = message
                        }
                    } else {
                        receivedAmountError = validation.error
                    }
                }) { Text(if (documentSendBusy) "확인 중..." else "알림톡 발송 요청") }
            },
            dismissButton = { TextButton(enabled = !documentSendBusy, onClick = { documentAlimtalkTarget = null }) { Text("취소") } }
        )
    }
    receiptPdfTarget?.let { q ->
        AlertDialog(
            onDismissRequest = { receiptPdfTarget = null },
            title = { Text("간이영수증 PDF 공유하기", fontWeight = FontWeight.Black) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("${q.customer} · ${q.id}", fontWeight = FontWeight.Bold)
                    Text("견적금액: ${won(q.total)}")
                    OutlinedTextField(
                        value = receiptPdfAmount,
                        onValueChange = { receiptPdfAmount = it; receiptPdfError = "" },
                        label = { Text("실제로 받은 금액 (원)") },
                        isError = receiptPdfError.isNotBlank(),
                        supportingText = { if (receiptPdfError.isNotBlank()) Text(receiptPdfError) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("입금이 확인된 금액만 영수증으로 발행하세요. PDF는 현재 기기에 생성되며 알림톡은 발송되지 않습니다.", fontSize = 12.sp, color = Muted)
                }
            },
            confirmButton = {
                Button(onClick = {
                    val result = validateReceiptAmountInput(receiptPdfAmount, q.total.toLong())
                    if (result.value == null) {
                        receiptPdfError = result.error
                    } else if (shareQuotePaymentDocumentPdf(context, q, "간이영수증", result.value)) {
                        receiptPdfTarget = null
                    }
                }) { Text("PDF 공유하기") }
            },
            dismissButton = { TextButton(onClick = { receiptPdfTarget = null }) { Text("취소") } }
        )
    }
    if (showIndustryExamples) {
        IndustryQuoteExamplePickerDialog(
            industry = industry,
            onDismiss = { showIndustryExamples = false },
            onSelect = { selected ->
                showIndustryExamples = false
                onExample(selected)
            }
        )
    }
    detail?.let { q -> QuoteDetailDialog(q, onDismiss = { detail = null }, onPdf = { onPdf(q) }, onDelivered = { onDelivered(q) }) }
    deleteTarget?.let { q ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            icon = { Icon(Icons.Default.DeleteOutline, null, tint = MaterialTheme.colorScheme.error) },
            title = { Text("견적서 삭제", fontWeight = FontWeight.Black) },
            text = { Text("${q.id} · ${q.customer} 견적서를 삭제하시겠습니까?\n\n삭제 후에는 견적 목록에서 복구할 수 없습니다. 이미 생성된 계약서는 유지됩니다.") },
            confirmButton = {
                Button(
                    onClick = { onDelete(q); deleteTarget = null },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("삭제") }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("취소") } }
        )
    }
}

@Composable
fun QuoteDetailDialog(q: Quote, onDismiss: () -> Unit, onPdf: () -> Unit, onDelivered: () -> Unit = {}) {
    var showAlimtalk by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("견적 상세", fontWeight = FontWeight.Black) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("${q.id} · ${q.createdAt}", color = Muted)
                Text("양식: ${templateLabel(q.template)}", color = Purple, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Text(q.customer, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                if (q.phone.isNotBlank()) Text("연락처  ${q.phone}")
                if (q.address.isNotBlank()) Text("고객주소  ${q.address}")
                if (q.siteAddress.isNotBlank()) Text("현장주소  ${q.siteAddress}")
                HorizontalDivider()
                q.items.forEachIndexed { index, item ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) { Text("${index + 1}. ${item.name}", fontWeight = FontWeight.Bold); Text("${decimalInputText(item.qty)} × ${won(item.unitPrice)}", color = Muted, fontSize = 13.sp) }
                        Text(won(item.qty * item.unitPrice), fontWeight = FontWeight.Bold)
                    }
                }
                HorizontalDivider()
                if (q.discountAmount > 0) MoneyLine("할인", -q.discountAmount)
                MoneyLine("공급가액", if (q.usesVatIncludedPricing && q.vatEnabled) q.discountedSupply - q.vat else q.discountedSupply)
                if (q.vatEnabled) MoneyLine("부가세", q.vat)
                MoneyLine("총 견적금액", q.total, bold = true)
                if (!q.vatEnabled) Text("부가세 별도", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.End, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Text("견적 유효기간: ${q.validUntil}까지 (${q.validityDays}일)", color = Muted, fontSize = 13.sp)
                if (q.note.isNotBlank()) { HorizontalDivider(); Text("특이사항", fontWeight = FontWeight.Bold); Text(q.note) }
            }
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(onClick = { showAlimtalk = true }) { Text("견적 알림톡") }
                Button(onClick = onPdf) { Icon(Icons.Default.PictureAsPdf, null); Spacer(Modifier.width(4.dp)); Text("PDF 공유") }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } }
    )
    if (showAlimtalk) {
        QuoteAlimtalkDialog(q, onDismiss = { showAlimtalk = false }, onDelivered = onDelivered)
    }

}

@Composable
private fun QuoteAlimtalkDialog(quote: Quote, onDismiss: () -> Unit, onDelivered: () -> Unit = {}) {
    val context = LocalContext.current
    val sender = remember { loadBusinessProfile(context).businessName.ifBlank { "ONEBIZ" } }
    OnebizAlimtalkDialog(
        type = "견적 안내",
        recipientName = quote.customer,
        initialPhone = quote.phone,
        initialTitle = "[$sender] 견적 안내",
        initialMessage = "${quote.customer}님, $sender 견적 안내입니다.\n견적번호: ${quote.id}\n견적금액: ${won(quote.total)}\n유효기간: ${quote.validUntil}\n문의: ${loadBusinessProfile(context).phone.ifBlank { "견적 담당자" }}",
        onDismiss = onDismiss,
        templateCode = "ONEBIZ_QUOTE_NOTICE",
        quoteId = quote.id,
        expectedQuote = quote,
        messageEditable = false,
        onDelivered = onDelivered,
        onSharePdf = { shareQuotePdf(context, quote, kakaoOnly = true) }
    )
}

@Composable
fun ContractScreen(
    contracts: List<Contract>,
    onEdit: (Contract) -> Unit,
    onPdf: (Contract) -> Unit,
    onKakaoSign: (Contract) -> Unit,
    onAlimtalkSign: (Contract) -> Unit,
    onSigned: (Contract) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnSigned by rememberUpdatedState(onSigned)
    var signingTarget by remember { mutableStateOf<Contract?>(null) }
    var signAlimtalkTarget by remember { mutableStateOf<Contract?>(null) }
    var originalTarget by remember { mutableStateOf<Contract?>(null) }
    signAlimtalkTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { signAlimtalkTarget = null },
            title = { Text("계약서 서명 알림톡 확인", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("원비즈 회원의 계약 상대방에게 카카오 알림톡을 요청합니다.")
                    Text("계약서: ${target.id} · ${target.customer}", fontWeight = FontWeight.Bold)
                    Text("수신번호: ${target.phone}")
                    Text("서버에서 가입 계정·고객번호·승인된 템플릿을 다시 확인합니다. 발송이 승인되면 요금이 발생할 수 있습니다.", color = Muted, fontSize = 12.sp)
                    Text("SOLAPI 접근 제한 또는 승인 변수 불일치 시 전송되지 않습니다.", color = Muted, fontSize = 12.sp)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    signAlimtalkTarget = null
                    onAlimtalkSign(target)
                }) { Text("알림톡 발송 요청") }
            },
            dismissButton = { TextButton(onClick = { signAlimtalkTarget = null }) { Text("취소") } }
        )
    }
    val pendingCount = contracts.count { !it.signed }
    val completedCount = contracts.count { it.signed }
    var showCompleted by remember { mutableStateOf(pendingCount == 0 && completedCount > 0) }

    LaunchedEffect(pendingCount, completedCount) {
        when {
            pendingCount == 0 && completedCount > 0 -> showCompleted = true
            pendingCount > 0 -> showCompleted = false
        }
    }

    // 계약 화면이 보일 때만 웹서명 상태를 확인한다. 앱을 떠나면 이 조회는 중지하며,
    // 사용자가 켠 백그라운드 문서 알림은 별도 WorkManager 주기로 처리한다.
    LaunchedEffect(lifecycleOwner, contracts.map { "${it.id}:${it.signed}" }) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                contracts.filterNot { it.signed }.forEach { contract ->
                    val refreshed = fetchWebSignStatus(context, contract)
                    if (refreshed?.signed == true) currentOnSigned(refreshed)
                }
                delay(15_000)
            }
        }
    }

    val visibleContracts = if (showCompleted) contracts.filter { it.signed } else contracts.filterNot { it.signed }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Header("계약서", "서명대기 계약과 체결된 계약서를 구분하여 관리합니다.")

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ContractCategoryCard(
                title = "서명대기",
                count = pendingCount,
                selected = !showCompleted,
                attention = pendingCount > 0,
                icon = Icons.Default.Schedule,
                selectedColor = OrangeSoft,
                accentColor = Color(0xFFD86800),
                modifier = Modifier.weight(1f),
                onClick = { showCompleted = false }
            )
            ContractCategoryCard(
                title = "체결된 계약서",
                count = completedCount,
                selected = showCompleted,
                attention = false,
                icon = Icons.Default.CheckCircle,
                selectedColor = GreenSoft,
                accentColor = Color(0xFF147A50),
                modifier = Modifier.weight(1f),
                onClick = { showCompleted = true }
            )
        }

        if (visibleContracts.isEmpty()) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                border = BorderStroke(1.dp, Border),
                shape = RoundedCornerShape(18.dp)
            ) {
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 26.dp, horizontal = 18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        if (showCompleted) Icons.Default.Description else Icons.Default.CheckCircle,
                        null,
                        tint = if (showCompleted) Muted else Color(0xFF147A50),
                        modifier = Modifier.size(34.dp)
                    )
                    Text(
                        when {
                            contracts.isEmpty() -> "아직 등록된 계약서가 없습니다."
                            showCompleted -> "아직 체결된 계약서가 없습니다."
                            else -> "현재 서명대기 중인 계약서가 없습니다."
                        },
                        color = Muted,
                        textAlign = TextAlign.Center,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        visibleContracts.reversed().forEach { c ->
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(20.dp)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(c.id, fontWeight = FontWeight.Black)
                        Status(if (c.signed) "계약체결완료" else "서명대기")
                    }
                    Text(c.customer, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                    Text(c.item, color = Muted)
                    Text(won(c.amount), fontSize = 22.sp, fontWeight = FontWeight.Black)
                    if (c.workDate.isNotBlank()) Text("시공예정일  ${c.workDate}", color = Muted)

                    if (c.signed) {
                        Card(colors = CardDefaults.cardColors(containerColor = GreenSoft), shape = RoundedCornerShape(14.dp)) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("체결된 계약서", fontWeight = FontWeight.Black, color = Color(0xFF147A50))
                                Text("서명자 ${c.signatureName.ifBlank { c.customer }} · ${c.signedAt}", fontSize = 13.sp)
                                Text("방식 ${c.signatureMethod.ifBlank { "전자서명" }} · 본인확인 ${c.identityStatus}", fontSize = 12.sp, color = Muted)
                                if (c.finalConfirmed) Text("최종확인 완료 · ${c.finalConfirmedAt}", fontSize = 12.sp, color = Color(0xFF147A50), fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { onEdit(c) }, modifier = Modifier.weight(1f)) { Icon(Icons.Default.Edit, null); Spacer(Modifier.width(4.dp)); Text("상세·수정") }
                        OutlinedButton(onClick = { onPdf(c) }, modifier = Modifier.weight(1f)) { Icon(Icons.Default.PictureAsPdf, null); Spacer(Modifier.width(4.dp)); Text("계약서 PDF") }
                    }

                    if (!c.signed) {
                        OutlinedButton(
                            onClick = { signingTarget = c },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp)
                        ) {
                            Icon(Icons.Default.Draw, null); Spacer(Modifier.width(6.dp)); Text("현장에서 직접 전자서명")
                        }

                        Button(
                            onClick = { onKakaoSign(c) },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFE812), contentColor = Color(0xFF191919))
                        ) {
                            Icon(Icons.Default.Send, null); Spacer(Modifier.width(6.dp)); Text("카카오톡으로 서명 요청")
                        }
                        OutlinedButton(
                            onClick = { signAlimtalkTarget = c },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp)
                        ) {
                            Icon(Icons.Default.Notifications, null); Spacer(Modifier.width(6.dp)); Text("카카오 알림톡으로 서명 요청")
                        }
                        Text("카카오톡 공유는 별도 앱에서 직접 보내고, 알림톡은 승인된 템플릿을 원비즈 서버가 발송합니다.", color = Muted, fontSize = 12.sp)
                        Text("카카오톡 링크에서 서명이 완료되면 최대 약 5초 안에 자동으로 체결된 계약서로 이동합니다.", color = Muted, fontSize = 12.sp)
                    } else {
                        OutlinedButton(
                            onClick = { originalTarget = c },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp)
                        ) {
                            Icon(Icons.Default.Visibility, null); Spacer(Modifier.width(6.dp)); Text(if (c.finalConfirmed) "원본보기 · 최종확인 완료" else "원본보기 · 최종확인")
                        }
                        Button(
                            onClick = { onKakaoSign(c) },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFE812), contentColor = Color(0xFF191919))
                        ) {
                            Icon(Icons.Default.Send, null); Spacer(Modifier.width(6.dp)); Text("카카오톡으로 체결 계약서 보내기")
                        }
                    }
                }
            }
        }
    }

    signingTarget?.let { contract ->
        ElectronicSignatureDialog(
            contract = contract,
            onDismiss = { signingTarget = null },
            onComplete = { signed ->
                onSigned(signed)
                signingTarget = null
            }
        )
    }

    originalTarget?.let { contract ->
        ContractFinalOriginalDialog(
            contract = contract,
            onDismiss = { originalTarget = null },
            onFinalConfirm = {
                onSigned(contract.copy(finalConfirmed = true, finalConfirmedAt = LocalDate.now().toString()))
                originalTarget = null
            }
        )
    }
}

@Composable
private fun ContractCategoryCard(
    title: String,
    count: Int,
    selected: Boolean,
    attention: Boolean,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selectedColor: Color,
    accentColor: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Card(
        modifier = modifier.height(98.dp).clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = if (selected) selectedColor else Color.White),
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) accentColor else Border),
        shape = RoundedCornerShape(18.dp)
    ) {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = if (selected || attention) accentColor else Muted, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(7.dp))
                Text(title, fontWeight = FontWeight.Black, fontSize = 15.sp, maxLines = 1, modifier = Modifier.weight(1f))
                if (attention) {
                    Surface(color = Color(0xFFFFE0C2), shape = RoundedCornerShape(50)) {
                        Text("확인 필요", color = Color(0xFFB55200), fontSize = 9.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp))
                    }
                }
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Text(count.toString(), color = if (selected || attention) accentColor else Text, fontSize = 25.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.width(3.dp))
                Text("건", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 3.dp))
            }
        }
    }
}

@Composable
fun ContractEditorDialog(contract: Contract, onDismiss: () -> Unit, onSave: (Contract) -> Unit, onPdf: (Contract) -> Unit) {
    var contractDate by remember(contract) { mutableStateOf(contract.contractDate) }
    var workDate by remember(contract) { mutableStateOf(contract.workDate) }
    var deposit by remember(contract) { mutableStateOf(contract.depositAmount.takeIf { it > 0 }?.toString() ?: "") }
    var depositDue by remember(contract) { mutableStateOf(contract.depositDueDate) }
    var middle by remember(contract) { mutableStateOf(contract.middleAmount.takeIf { it > 0 }?.toString() ?: "") }
    var middleDue by remember(contract) { mutableStateOf(contract.middleDueDate) }
    var useDeposit by remember(contract) { mutableStateOf(contract.depositAmount > 0 || contract.depositDueDate.isNotBlank()) }
    var useMiddle by remember(contract) { mutableStateOf(contract.middleAmount > 0 || contract.middleDueDate.isNotBlank()) }
    var balanceDue by remember(contract) { mutableStateOf(contract.balanceDueDate) }
    var contractType by remember(contract) { mutableStateOf(contract.contractType) }
    var standardTerms by remember(contract) { mutableStateOf(contract.standardTerms.ifBlank { contractTermsFor(contract.contractType) }) }
    var typeMenuExpanded by remember { mutableStateOf(false) }
    var terms by remember(contract) { mutableStateOf(contract.specialTerms) }
    var showStandardTerms by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf(false) }

    val depositValue = if (useDeposit) parseMoneyInput(deposit) else 0
    val middleValue = if (useMiddle) parseMoneyInput(middle) else 0
    val validPayments = (!useDeposit || wholeWonInputValue(deposit) != null) && (!useMiddle || wholeWonInputValue(middle) != null)
    val partialPayments = depositValue.toLong() + middleValue.toLong()
    val balanceValue = (contract.amount.toLong() - partialPayments).coerceAtLeast(0).toInt()
    val overAmount = (partialPayments - contract.amount.toLong()).coerceAtLeast(0)

    val hasUnsavedChanges =
        contractDate != contract.contractDate || workDate != contract.workDate ||
        deposit != (contract.depositAmount.takeIf { it > 0 }?.toString() ?: "") ||
        depositDue != contract.depositDueDate || middle != (contract.middleAmount.takeIf { it > 0 }?.toString() ?: "") ||
        middleDue != contract.middleDueDate ||
        useDeposit != (contract.depositAmount > 0 || contract.depositDueDate.isNotBlank()) ||
        useMiddle != (contract.middleAmount > 0 || contract.middleDueDate.isNotBlank()) ||
        balanceDue != contract.balanceDueDate || contractType != contract.contractType ||
        standardTerms != contract.standardTerms.ifBlank { contractTermsFor(contract.contractType) } ||
        terms != contract.specialTerms
    var showDiscardPrompt by remember { mutableStateOf(false) }
    fun requestDismiss() {
        if (hasUnsavedChanges) showDiscardPrompt = true else onDismiss()
    }

    val draft = contract.copy(
        contractDate = contractDate,
        workDate = workDate,
        depositAmount = depositValue,
        depositDueDate = if (useDeposit) depositDue else "",
        middleAmount = middleValue,
        middleDueDate = if (useMiddle) middleDue else "",
        balanceAmount = balanceValue,
        balanceDueDate = balanceDue,
        standardTerms = standardTerms,
        contractType = contractType,
        specialTerms = terms
    )

    AlertDialog(
        modifier = Modifier.imePadding(),
        onDismissRequest = ::requestDismiss,
        title = { Text("계약서 작성 · ${contract.id}", fontWeight = FontWeight.Black) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Text("${contract.customer} · ${contract.phone}", fontWeight = FontWeight.Bold)
                Text(contract.address.ifBlank { "주소 미등록" }, color = Muted)
                Text("총 계약금액 ${won(contract.amount)}", fontSize = 20.sp, fontWeight = FontWeight.Black, color = Purple)

                Text("계약 유형", fontWeight = FontWeight.Black, fontSize = 17.sp)
                Box {
                    OutlinedButton(onClick = { typeMenuExpanded = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(contractType, modifier = Modifier.weight(1f)); Icon(Icons.Default.ExpandMore, null)
                    }
                    DropdownMenu(expanded = typeMenuExpanded, onDismissRequest = { typeMenuExpanded = false }) {
                        contractTypes.forEach { option ->
                            DropdownMenuItem(text = { Text(option) }, onClick = {
                                typeMenuExpanded = false
                                if (option != contractType) {
                                    contractType = option
                                    standardTerms = contractTermsFor(option)
                                }
                            })
                        }
                    }
                }
                Text("유형을 바꾸면 아래 계약조건이 해당 유형의 기본 문구로 바뀝니다. 수정한 문구는 다시 확인해 주세요.", color = Muted, fontSize = 12.sp)

                ContractDateField("계약일", contractDate) { contractDate = it }
                ContractDateField("시공예정일", workDate) { workDate = it }
                Text("시공예정일을 입력해 계약서를 저장하면 고객 일정표에 자동 표시됩니다.",
                    color = Muted, fontSize = 12.sp)

                Text("지급 일정", fontWeight = FontWeight.Black, fontSize = 17.sp)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Checkbox(checked = useDeposit, onCheckedChange = { useDeposit = it })
                    Text("계약금 일정 입력", fontWeight = FontWeight.Bold)
                }
                if (useDeposit) {
                    ContractMoneyField("계약금", deposit) { deposit = normalizeMoneyDigits(it) }
                    ContractDateField("계약금 지급예정일", depositDue) { depositDue = it }
                }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Checkbox(checked = useMiddle, onCheckedChange = { useMiddle = it })
                    Text("중도금 일정 입력", fontWeight = FontWeight.Bold)
                }
                if (useMiddle) {
                    ContractMoneyField("중도금", middle) { middle = normalizeMoneyDigits(it) }
                    ContractDateField("중도금 지급예정일", middleDue) { middleDue = it }
                }

                OutlinedTextField(
                    value = balanceValue.toString(),
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("잔금 · 자동계산") },
                    visualTransformation = MoneyVisualTransformation,
                    suffix = { Text("원") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = GreenSoft, unfocusedContainerColor = GreenSoft)
                )
                Text("총 계약금액 - 계약금 - 중도금으로 자동 계산됩니다.", color = Muted, fontSize = 12.sp)
                ContractDateField("잔금 지급예정일", balanceDue) { balanceDue = it }

                if (overAmount > 0) {
                    Text("계약금과 중도금의 합계가 총 계약금액보다 ${won(overAmount)} 많습니다.", color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }
                if (!validPayments) Text("계약금과 중도금은 0 이상의 원 단위 정수로 입력해 주세요.", color = MaterialTheme.colorScheme.error, fontSize = 12.sp)

                Text("표준 계약조건", fontWeight = FontWeight.Black, fontSize = 17.sp)
                Text("계약서 생성 시 기본 계약조건이 자동으로 들어갑니다. 필요한 경우 계약별로 수정할 수 있습니다.", color = Muted, fontSize = 12.sp)
                OutlinedButton(onClick = { showStandardTerms = !showStandardTerms }, modifier = Modifier.fillMaxWidth()) {
                    Icon(if (showStandardTerms) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
                    Spacer(Modifier.width(5.dp))
                    Text(if (showStandardTerms) "표준 계약조건 접기" else "표준 계약조건 펼쳐보기 / 수정")
                }
                if (showStandardTerms) {
                    OutlinedTextField(
                        value = standardTerms,
                        onValueChange = { standardTerms = it },
                        label = { Text("표준 계약조건") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 12
                    )
                    TextButton(onClick = { standardTerms = contractTermsFor(contractType) }) { Text("선택 유형의 기본 조건으로 되돌리기") }
                }
                OutlinedTextField(
                    terms,
                    { terms = it },
                    label = { Text("현장 특약사항 (선택)") },
                    placeholder = { Text("예: 전기공사 별도, 추가 배관 별도") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2
                )
                Card(colors = CardDefaults.cardColors(containerColor = PurpleSoft), shape = RoundedCornerShape(14.dp)) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("전자서명", fontWeight = FontWeight.Black)
                        Text(if (contract.signed) "전자서명 완료 · ${contract.signedAt}" else "계약서를 저장한 후 계약목록에서 고객 전자서명을 진행합니다.", color = Muted, fontSize = 12.sp)
                    }
                }

                OutlinedButton(onClick = { preview = true }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Visibility, null); Spacer(Modifier.width(4.dp)); Text("계약서 미리보기")
                }
                OutlinedButton(onClick = { onPdf(draft) }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.PictureAsPdf, null); Spacer(Modifier.width(4.dp)); Text("계약서 PDF")
                }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(draft) }, enabled = validPayments && overAmount == 0L && !contract.signed) { Text(if (contract.signed) "서명 완료 · 수정 불가" else "계약서 저장") }
        },
        dismissButton = { TextButton(onClick = ::requestDismiss) { Text("닫기") } }
    )
    if (showDiscardPrompt) {
        AlertDialog(
            onDismissRequest = { showDiscardPrompt = false },
            title = { Text("저장하지 않은 계약서") },
            text = { Text("수정한 계약 내용이 저장되지 않았습니다. 그대로 나가시겠습니까?") },
            confirmButton = { TextButton(onClick = { showDiscardPrompt = false; onDismiss() }) { Text("버리고 나가기") } },
            dismissButton = { TextButton(onClick = { showDiscardPrompt = false }) { Text("계속 작성") } }
        )
    }
    if (preview) ContractPreviewDialog(draft) { preview = false }
}

@Composable
fun ContractDateField(label: String, value: String, onDateSelected: (String) -> Unit) {
    val context = LocalContext.current
    fun openCalendar() {
        val base = runCatching { LocalDate.parse(value) }.getOrElse { LocalDate.now() }
        DatePickerDialog(
            context,
            { _, year, month, day ->
                onDateSelected(LocalDate.of(year, month + 1, day).toString())
            },
            base.year,
            base.monthValue - 1,
            base.dayOfMonth
        ).show()
    }
    OutlinedTextField(
        value = value,
        onValueChange = {},
        readOnly = true,
        label = { Text(label) },
        placeholder = { Text("날짜 선택") },
        trailingIcon = {
            IconButton(onClick = { openCalendar() }) {
                Icon(Icons.Default.CalendarMonth, contentDescription = "$label 달력")
            }
        },
        modifier = Modifier.fillMaxWidth().clickable { openCalendar() },
        singleLine = true
    )
}

@Composable
fun ContractMoneyField(label: String, value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(value, onValueChange, label = { Text(label) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        visualTransformation = MoneyVisualTransformation, suffix = { Text("원") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
}

@Composable
fun ContractPreviewDialog(c: Contract, onDismiss: () -> Unit) {
    var showAlimtalk by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val documentOwnerId = remember { onebizCloudUserId(context) }
    val documentOwnerToken = remember { onebizCloudToken(context) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("계약서 미리보기", fontWeight = FontWeight.Black) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("${c.id} · 견적 ${c.quoteId}", color = Muted); Text(c.customer, fontSize = 21.sp, fontWeight = FontWeight.Black)
            Text("연락처  ${c.phone}"); Text("현장주소  ${fullSiteAddress(c).ifBlank { "미등록" }}"); HorizontalDivider()
            Text("계약 유형  ${c.contractType}"); Text("계약내용  ${c.item}"); MoneyLine("총 계약금액", c.amount, true); Text("계약일  ${c.contractDate}"); Text("시공예정일  ${c.workDate.ifBlank { "미정" }}"); HorizontalDivider()
            MoneyLine("계약금", c.depositAmount); Text("지급예정일  ${c.depositDueDate.ifBlank { "미정" }}", color = Muted)
            MoneyLine("중도금", c.middleAmount); Text("지급예정일  ${c.middleDueDate.ifBlank { "미정" }}", color = Muted)
            MoneyLine("잔금", c.balanceAmount); Text("지급예정일  ${c.balanceDueDate.ifBlank { "미정" }}", color = Muted)
            HorizontalDivider(); Text("표준 계약조건", fontWeight = FontWeight.Bold)
            Text(c.standardTerms.ifBlank { defaultStandardContractTerms() }, fontSize = 12.sp)
            if (c.specialTerms.isNotBlank()) { HorizontalDivider(); Text("현장 특약사항", fontWeight = FontWeight.Bold); Text(c.specialTerms) }
            HorizontalDivider(); Text("고객 서명  ${c.signatureName.ifBlank { if (c.signed) c.customer else "서명 전" }}", fontWeight = FontWeight.Bold); if (c.signed) Text("전자서명 ${c.signatureMethod} · 본인확인 ${c.identityStatus} · ${c.signedAt}", color = Muted, fontSize = 12.sp)
        }
    }, confirmButton = {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = {
                if (c.signed) Toast.makeText(context, "계약 체결 완료 알림톡은 변수 확인 후 사용 가능합니다.", Toast.LENGTH_LONG).show()
                else showAlimtalk = true
            }) { Text(if (c.signed) "알림톡 준비 중" else "서명요청 알림톡") }
            Button(onClick = onDismiss) { Text("확인") }
        }
    })
    if (showAlimtalk) {
        AlertDialog(
            onDismissRequest = { showAlimtalk = false },
            title = { Text("계약서 서명 알림톡 발송 확인") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("수신 고객: ${c.customer} · ${c.phone}")
                    Text("원비즈 서버에서 승인 상태를 확인한 후에만 발송합니다.", color = Muted, fontSize = 12.sp)
                }
            },
            confirmButton = { TextButton(onClick = {
                showAlimtalk = false
                sendOnebizContractSignAlimtalk(context, c, documentOwnerId, documentOwnerToken)
            }) { Text("발송 요청") } },
            dismissButton = { TextButton(onClick = { showAlimtalk = false }) { Text("취소") } }
        )
    }
}

@Composable
fun ContractFinalOriginalDialog(
    contract: Contract,
    onDismiss: () -> Unit,
    onFinalConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("체결 계약서 원본", fontWeight = FontWeight.Black) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${contract.id} · 견적 ${contract.quoteId}", color = Muted)
                Text(contract.customer, fontSize = 22.sp, fontWeight = FontWeight.Black)
                Text("연락처  ${contract.phone}")
                Text("현장주소  ${fullSiteAddress(contract).ifBlank { "미등록" }}")
                HorizontalDivider()
                Text("계약 유형  ${contract.contractType}", fontWeight = FontWeight.Bold)
                Text("계약내용", fontWeight = FontWeight.Bold)
                Text(contract.item)
                MoneyLine("총 계약금액", contract.amount, true)
                Text("계약일  ${contract.contractDate}")
                Text("시공예정일  ${contract.workDate.ifBlank { "미정" }}")
                HorizontalDivider()
                Text("전자서명", fontWeight = FontWeight.Bold)
                Text("서명자 ${contract.signatureName.ifBlank { contract.customer }}")
                Text("${contract.signatureMethod.ifBlank { "전자서명" }} · ${contract.identityStatus} · ${contract.signedAt}", color = Muted, fontSize = 12.sp)
                HorizontalDivider()
                Text("표준 계약조건", fontWeight = FontWeight.Bold)
                Text(contract.standardTerms.ifBlank { defaultStandardContractTerms() }, fontSize = 11.sp)
                if (contract.specialTerms.isNotBlank()) {
                    HorizontalDivider(); Text("현장 특약사항", fontWeight = FontWeight.Bold); Text(contract.specialTerms)
                }
                if (contract.finalConfirmed) {
                    HorizontalDivider(); Text("최종확인 완료 · ${contract.finalConfirmedAt}", color = Color(0xFF147A50), fontWeight = FontWeight.Bold)
                }
            }
        },
        confirmButton = {
            Button(onClick = onFinalConfirm) {
                Text(if (contract.finalConfirmed) "확인 후 나가기" else "최종확인 완료")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } }
    )
}

@Composable
fun ElectronicSignatureDialog(
    contract: Contract,
    onDismiss: () -> Unit,
    onComplete: (Contract) -> Unit
) {
    var contractChecked by remember { mutableStateOf(false) }
    var consentChecked by remember { mutableStateOf(false) }
    var identityChecked by remember { mutableStateOf(false) }
    var signerName by remember(contract) { mutableStateOf(contract.customer) }
    var strokes by remember { mutableStateOf<List<List<Offset>>>(emptyList()) }

    val hasSignature = strokes.any { it.size >= 2 }
    val canComplete = contractChecked && consentChecked && identityChecked && signerName.isNotBlank() && hasSignature

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("고객 전자서명 · ${contract.id}", fontWeight = FontWeight.Black) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(contract.customer, fontSize = 20.sp, fontWeight = FontWeight.Black)
                Text("${contract.phone} · ${won(contract.amount)}", color = Muted)
                Text("계약내용  ${contract.item}")
                if (contract.workDate.isNotBlank()) Text("시공예정일  ${contract.workDate}")

                HorizontalDivider()
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(contractChecked, { contractChecked = it })
                    Text("계약서 내용, 표준 계약조건 및 현장 특약사항을 확인했습니다.", modifier = Modifier.weight(1f), fontSize = 13.sp)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(consentChecked, { consentChecked = it })
                    Text("전자적 방법으로 서명하고 전자계약 완료본을 보관하는 것에 동의합니다.", modifier = Modifier.weight(1f), fontSize = 13.sp)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(identityChecked, { identityChecked = it })
                    Text("담당자가 계약 상대방 본인임을 현장에서 확인했습니다.", modifier = Modifier.weight(1f), fontSize = 13.sp)
                }
                Text("※ 이 체크는 PASS/SMS 본인인증이 아닙니다. 외부 본인인증 API 연결 전에는 '현장 확인' 기록으로 저장됩니다.", color = Muted, fontSize = 11.sp)

                OutlinedTextField(
                    signerName,
                    { signerName = it },
                    label = { Text("서명자 이름") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                Text("아래 칸에 손가락으로 서명하세요.", fontWeight = FontWeight.Bold)
                Surface(
                    modifier = Modifier.fillMaxWidth().height(190.dp),
                    shape = RoundedCornerShape(14.dp),
                    color = Color.White,
                    border = BorderStroke(1.dp, Border)
                ) {
                    Canvas(
                        Modifier.fillMaxSize().pointerInput(Unit) {
                            detectDragGestures(
                                onDragStart = { offset -> strokes = strokes + listOf(listOf(offset)) },
                                onDrag = { change, _ ->
                                    change.consume()
                                    val mutable = strokes.toMutableList()
                                    if (mutable.isNotEmpty()) mutable[mutable.lastIndex] = mutable.last() + change.position
                                    strokes = mutable
                                }
                            )
                        }
                    ) {
                        strokes.forEach { stroke ->
                            stroke.zipWithNext().forEach { (a, b) ->
                                drawLine(color = Text, start = a, end = b, strokeWidth = 5f, cap = StrokeCap.Round)
                            }
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(if (hasSignature) "서명이 입력되었습니다." else "서명이 필요합니다.", color = if (hasSignature) Color(0xFF147A50) else Muted, fontSize = 12.sp)
                    TextButton(onClick = { strokes = emptyList() }) { Text("서명 지우기") }
                }
            }
        },
        confirmButton = {
            Button(
                enabled = canComplete,
                onClick = {
                    val now = java.time.LocalDateTime.now().withSecond(0).withNano(0).toString().replace('T', ' ')
                    onComplete(
                        contract.copy(
                            signed = true,
                            signatureName = signerName.trim(),
                            signaturePath = serializeSignature(strokes),
                            signatureMethod = "현장 직접 전자서명",
                            identityStatus = "현장확인",
                            consentAccepted = true,
                            signedAt = now
                        )
                    )
                }
            ) { Text("전자서명 완료") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } }
    )
}

fun serializeSignature(strokes: List<List<Offset>>): String = strokes.joinToString("|") { stroke ->
    stroke.joinToString(";") { p -> "${p.x},${p.y}" }
}

fun parseSignature(serialized: String): List<List<Pair<Float, Float>>> {
    if (serialized.isBlank()) return emptyList()
    return serialized.split('|').mapNotNull { stroke ->
        val pts = stroke.split(';').mapNotNull { token ->
            val xy = token.split(',')
            if (xy.size != 2) null else {
                val x = xy[0].toFloatOrNull(); val y = xy[1].toFloatOrNull()
                if (x == null || y == null) null else x to y
            }
        }
        pts.takeIf { it.size >= 2 }
    }
}

private fun dueDateOrNull(value: String): LocalDate? = runCatching { LocalDate.parse(value) }.getOrNull()

private data class InstallmentState(val label: String, val planned: Int, val paid: Int, val due: String) {
    val remaining: Int get() = (planned - paid).coerceAtLeast(0)
    val isComplete: Boolean get() = planned <= 0 || remaining == 0
    val isOverdue: Boolean get() = !isComplete && dueDateOrNull(due)?.isBefore(LocalDate.now()) == true
}

private fun installmentStates(c: Contract): List<InstallmentState> {
    var leftPaid = c.paidAmount.coerceIn(0, c.amount)
    fun take(label: String, planned: Int, due: String): InstallmentState {
        val paid = leftPaid.coerceAtMost(planned.coerceAtLeast(0))
        leftPaid = (leftPaid - paid).coerceAtLeast(0)
        return InstallmentState(label, planned.coerceAtLeast(0), paid, due)
    }
    return listOf(
        take("계약금", c.depositAmount, c.depositDueDate),
        take("중도금", c.middleAmount, c.middleDueDate),
        take("잔금", c.balanceAmount, c.balanceDueDate)
    ).filter { it.planned > 0 }
}

private fun paymentStatus(c: Contract): String {
    val remain = (c.amount - c.paidAmount).coerceAtLeast(0)
    return if (remain == 0) "완납" else "미수금"
}

@Composable
fun PaymentScreen(
    contracts: List<Contract>,
    businessProfile: BusinessProfile,
    onPayment: (String, Int) -> Unit,
    onPaymentEdit: (String, Int) -> Unit,
    onDelete: (String) -> Unit,
    onDebtUpdate: (Contract) -> Unit
) {
    var alimtalkTarget by remember { mutableStateOf<Contract?>(null) }
    val context = LocalContext.current
    var filter by remember { mutableStateOf("전체") }
    var target by remember { mutableStateOf<Pair<Contract, Int>?>(null) }
    var editPaymentTarget by remember { mutableStateOf<Contract?>(null) }
    var deleteTarget by remember { mutableStateOf<Contract?>(null) }
    var debtTarget by remember { mutableStateOf<Contract?>(null) }
    var showAlimtalkHistory by remember { mutableStateOf(false) }
    val signedContracts = contracts.filter { it.signed && !it.paymentHidden }
    val totalReceivable = signedContracts.sumOf { (it.amount - it.paidAmount).coerceAtLeast(0) }
    val overdueCount = signedContracts.count { paymentStatus(it) == "미수금" }
    val paidCount = signedContracts.count { paymentStatus(it) == "완납" }
    val debtOnly = signedContracts.filter { paymentStatus(it) == "미수금" }
    val firstDemandCount = debtOnly.count { it.debtStatus == "1차 독촉" || it.debtStatus == "2차 독촉" }
    val certifiedCount = debtOnly.count { it.debtStatus == "내용증명 준비" || it.debtStatus == "내용증명 발송" }
    val legalCount = debtOnly.count { it.debtStatus == "소송 준비" }
    val visible = signedContracts.filter { c ->
        when (filter) {
            "미수금" -> paymentStatus(c) == "미수금"
            "완납" -> paymentStatus(c) == "완납"
            else -> true
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Header("대금관리", "계약 체결 즉시 총 계약금액에서 입금액을 뺀 금액을 미수금으로 관리합니다.")

        Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MoneyLine("총 미수금", totalReceivable, bold = true)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("미수 ${overdueCount}건", color = Muted)
                    Text("완납 ${paidCount}건", color = Muted)
                }
            }
        }

        if (totalReceivable > 0) {
            Card(colors = CardDefaults.cardColors(containerColor = PurpleSoft), shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("미수금 법적조치 센터", fontWeight = FontWeight.Black, fontSize = 17.sp)
                    Text("지급요청 → 내용증명 → 소송자료 준비 순서로 진행상태를 관리합니다.", color = Muted, fontSize = 12.sp)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("지급안내 ${firstDemandCount}건", fontSize = 12.sp)
                        Text("내용증명 ${certifiedCount}건", fontSize = 12.sp)
                        Text("소송준비 ${legalCount}건", fontSize = 12.sp)
                    }
                    OutlinedButton(onClick = { showAlimtalkHistory = true }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.History, null)
                        Spacer(Modifier.width(6.dp))
                        Text("대금·내용증명 알림톡 발송기록")
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("전체", "미수금", "완납").forEach { name ->
                FilterChip(
                    selected = filter == name,
                    onClick = { filter = name },
                    label = { Text(name, fontSize = 12.sp) },
                    modifier = Modifier.weight(1f)
                )
            }
        }

        if (visible.isEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(18.dp)) {
                Text("해당 상태의 대금 내역이 없습니다.", Modifier.fillMaxWidth().padding(22.dp), color = Muted, textAlign = TextAlign.Center)
            }
        }

        visible.reversed().forEach { c ->
            val remain = (c.amount - c.paidAmount).coerceAtLeast(0)
            val stages = installmentStates(c)
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(20.dp)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column {
                            Text(c.customer, fontSize = 19.sp, fontWeight = FontWeight.Black)
                            Text(c.id, color = Muted, fontSize = 12.sp)
                        }
                        Status(paymentStatus(c))
                    }
                    Text(c.item, color = Muted)
                    MoneyLine("총 계약금액", c.amount)
                    MoneyLine("입금액", c.paidAmount)
                    MoneyLine("미수금", remain, bold = true)
                    if (remain > 0) {
                        Text("채권상태: ${c.debtStatus}", color = MaterialTheme.colorScheme.error, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        if (c.demandDueDate.isNotBlank()) Text("최종 지급요청일: ${c.demandDueDate}", color = Muted, fontSize = 12.sp)
                    }

                    if (stages.isNotEmpty()) {
                        HorizontalDivider(color = Border)
                        stages.forEach { stage ->
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(stage.label, fontWeight = FontWeight.Bold)
                                    Text(if (stage.isComplete) "입금완료" else "미수", color = if (stage.isComplete) Muted else MaterialTheme.colorScheme.error, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                                Text("약정 ${won(stage.planned)} · 입금 ${won(stage.paid)} · 남음 ${won(stage.remaining)}", fontSize = 13.sp)
                                Text("지급예정일 ${stage.due.ifBlank { "미정" }}", color = Muted, fontSize = 12.sp)
                            }
                        }
                    }

                    if (remain > 0) {
                        Button(onClick = { target = c to remain }, modifier = Modifier.fillMaxWidth()) { Text("입금 등록") }
                    }
                    if (c.paidAmount > 0) {
                        OutlinedButton(
                            onClick = { editPaymentTarget = c },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.Edit, null)
                            Spacer(Modifier.width(6.dp))
                            Text("입금액 수정")
                        }
                    }
                    if (remain > 0) {
                        OutlinedButton(onClick = { debtTarget = c }, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.Description, null); Spacer(Modifier.width(6.dp)); Text("채권관리 · 내용증명 · 전자소송 준비")
                        }
                        OutlinedButton(onClick = { alimtalkTarget = c }, modifier = Modifier.fillMaxWidth()) {
                            Text("카카오 알림톡으로 미수금 안내")
                        }
                    }

                    HorizontalDivider(color = Border)
                    Text("증빙 발행", fontWeight = FontWeight.Bold)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OutlinedButton(onClick = { openHometax(context, "현금영수증") }, modifier = Modifier.weight(1f)) { Text("현금영수증", fontSize = 12.sp) }
                        OutlinedButton(onClick = { openHometax(context, "세금계산서") }, modifier = Modifier.weight(1f)) { Text("세금계산서", fontSize = 12.sp) }
                    }
                    OutlinedButton(
                        onClick = { deleteTarget = c },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                    ) {
                        Icon(Icons.Default.DeleteOutline, null); Spacer(Modifier.width(6.dp)); Text("대금관리에서 삭제")
                    }
                }
            }
        }
    }

    target?.let { (c, suggested) ->
        val remaining = (c.amount - c.paidAmount).coerceAtLeast(0)
        PaymentDialog(remaining, suggested, onDismiss = { target = null }) {
            onPayment(c.id, it)
            target = null
        }
    }

    editPaymentTarget?.let { c ->
        PaymentEditDialog(
            contractAmount = c.amount,
            currentPaidAmount = c.paidAmount,
            onDismiss = { editPaymentTarget = null },
            onSave = { corrected ->
                onPaymentEdit(c.id, corrected)
                editPaymentTarget = null
            }
        )
    }

    debtTarget?.let { c ->
        DebtManagementDialog(
            contract = c,
            businessProfile = businessProfile,
            onDismiss = { debtTarget = null },
            onUpdate = { updated -> onDebtUpdate(updated); debtTarget = updated }
        )
    }

    alimtalkTarget?.let { c ->
        DebtAlimtalkDialog(
            contract = c,
            businessProfile = businessProfile,
            onDismiss = { alimtalkTarget = null },
            onDebtUpdate = { updated -> onDebtUpdate(updated); alimtalkTarget = updated }
        )
    }

    if (showAlimtalkHistory) {
        AlimtalkHistoryDialog(onDismiss = { showAlimtalkHistory = false })
    }

    deleteTarget?.let { c ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("대금 내역 삭제") },
            text = { Text("${c.customer}님의 대금 내역을 대금관리에서 숨길까요? 체결된 계약서는 삭제되지 않습니다.") },
            confirmButton = {
                TextButton(onClick = { onDelete(c.id); deleteTarget = null }) { Text("삭제", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("취소") } }
        )
    }
}


@Composable
private fun DebtManagementDialog(
    contract: Contract,
    businessProfile: BusinessProfile,
    onDismiss: () -> Unit,
    onUpdate: (Contract) -> Unit
) {
    val context = LocalContext.current
    val remain = (contract.amount - contract.paidAmount).coerceAtLeast(0)
    var memo by remember(contract.id, contract.debtMemo) { mutableStateOf(contract.debtMemo) }
    var originalDueDate by remember(contract.id, contract.balanceDueDate) { mutableStateOf(contract.balanceDueDate) }
    var dueDate by remember(contract.id, contract.demandDueDate) { mutableStateOf(contract.demandDueDate.ifBlank { LocalDate.now().plusDays(7).toString() }) }
    var factsConfirmed by remember(contract.id) { mutableStateOf(false) }
    var showPreview by remember { mutableStateOf(false) }

    val originalDueParsed = runCatching { LocalDate.parse(originalDueDate) }.getOrNull()
    val originalDuePassed = originalDueParsed?.isBefore(LocalDate.now()) == true
    val dueParsed = runCatching { LocalDate.parse(dueDate) }.getOrNull()
    val dueValid = dueParsed != null && !dueParsed.isBefore(LocalDate.now())
    val senderReady = if (businessProfile.isBusiness) {
        businessProfile.businessName.isNotBlank() && businessProfile.representative.isNotBlank()
    } else {
        businessProfile.businessName.isNotBlank() || businessProfile.representative.isNotBlank()
    }
    val registrationReady = !businessProfile.isBusiness || businessProfile.registrationNo.isNotBlank()
    val senderAddressReady = businessProfile.fullAddress.isNotBlank()
    val receiverReady = contract.customer.isNotBlank()
    val receiverAddressReady = contract.address.isNotBlank()
    val requiredInfoReady = remain > 0 && senderReady && registrationReady && senderAddressReady &&
        receiverReady && receiverAddressReady && originalDueParsed != null && dueValid
    val canPreviewLegalDocs = requiredInfoReady
    val canCreateLegalDocs = requiredInfoReady && factsConfirmed

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("미수금 법적조치 · ${contract.customer}", fontWeight = FontWeight.Black) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("계약번호 ${contract.id}", color = Muted)
                MoneyLine("총 계약금액", contract.amount)
                MoneyLine("기입금액", contract.paidAmount)
                MoneyLine("현재 미수금", remain, bold = true)
                Text("현재 진행단계: ${if (remain == 0) "완납" else contract.debtStatus}", fontWeight = FontWeight.Bold)

                HorizontalDivider(color = Border)
                Text("필수정보 점검", fontWeight = FontWeight.Black)
                fun mark(ok: Boolean, label: String): String = (if (ok) "✓ " else "⚠ ") + label
                Text(mark(senderReady, "발신인 상호/대표자"), color = if (senderReady) Muted else MaterialTheme.colorScheme.error, fontSize = 12.sp)
                Text(mark(registrationReady, "발신인 사업자등록번호"), color = if (registrationReady) Muted else MaterialTheme.colorScheme.error, fontSize = 12.sp)
                Text(mark(senderAddressReady, "발신인 주소"), color = if (senderAddressReady) Muted else MaterialTheme.colorScheme.error, fontSize = 12.sp)
                Text(mark(receiverReady, "고객명"), color = if (receiverReady) Muted else MaterialTheme.colorScheme.error, fontSize = 12.sp)
                Text(mark(receiverAddressReady, "고객 주소"), color = if (receiverAddressReady) Muted else MaterialTheme.colorScheme.error, fontSize = 12.sp)
                Text(mark(originalDueParsed != null, "약정 잔금 지급일"), color = if (originalDueParsed != null) Muted else MaterialTheme.colorScheme.error, fontSize = 12.sp)
                Text(mark(dueValid, "최종 지급요청일"), color = if (dueValid) Muted else MaterialTheme.colorScheme.error, fontSize = 12.sp)
                if (!requiredInfoReady && remain > 0) {
                    Text("필수정보와 날짜를 모두 입력하면 미리보기가 활성화됩니다.", color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                } else if (!factsConfirmed) {
                    Text("PDF를 만들려면 아래 사실확인 항목을 체크하세요.", color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                } else if (originalDuePassed) {
                    Text("지급기일이 경과하여 '미지급 대금 지급 최고' 양식으로 생성됩니다.", color = Purple, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                } else {
                    Text("지급기일 전이므로 '지급기일 사전 안내' 양식으로 생성됩니다.", color = Color(0xFFC46A00), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }

                HorizontalDivider(color = Border)
                Text("자동기입 정보", fontWeight = FontWeight.Bold)
                Text("발신인: ${businessProfile.businessName.ifBlank { businessProfile.representative.ifBlank { "미등록" } }}", fontSize = 13.sp)
                Text("발신주소: ${businessProfile.fullAddress.ifBlank { "미등록" }}", color = Muted, fontSize = 12.sp)
                Text("수신인: ${contract.customer}", fontSize = 13.sp)
                Text("수신주소: ${contract.address.ifBlank { "미등록" }}", color = Muted, fontSize = 12.sp)
                if (businessProfile.bankName.isNotBlank() || businessProfile.accountNumber.isNotBlank()) {
                    Text("입금계좌: ${businessProfile.bankName} ${businessProfile.accountNumber} ${businessProfile.accountHolder}", color = Muted, fontSize = 12.sp)
                }

                OutlinedTextField(
                    value = originalDueDate,
                    onValueChange = { originalDueDate = it },
                    label = { Text("약정 잔금 지급일 (YYYY-MM-DD)") },
                    supportingText = {
                        if (originalDueParsed == null) Text("계약서에 정한 잔금 지급일을 입력하세요.")
                        else if (!originalDuePassed) Text("지급기일 전에는 사전 지급안내 양식으로 작성됩니다.")
                    },
                    isError = originalDueParsed == null,
                    modifier = Modifier.fillMaxWidth(), singleLine = true
                )
                OutlinedTextField(
                    value = dueDate,
                    onValueChange = { dueDate = it },
                    label = { Text("최종 지급요청일 (YYYY-MM-DD)") },
                    supportingText = { if (!dueValid) Text("오늘 이후 날짜를 YYYY-MM-DD 형식으로 입력하세요.") },
                    isError = !dueValid,
                    modifier = Modifier.fillMaxWidth(), singleLine = true
                )
                OutlinedTextField(
                    value = memo,
                    onValueChange = { memo = it },
                    label = { Text("채권관리 메모") },
                    modifier = Modifier.fillMaxWidth(), minLines = 2
                )

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = factsConfirmed, onCheckedChange = { factsConfirmed = it })
                    Text("계약내용, 공사·용역 이행, 입금액 및 미수금이 사실과 일치함을 확인합니다.", fontSize = 12.sp)
                }
                Text(
                    "※ 법률정보를 반영한 자동작성 양식이며 개별 사건에 대한 변호사 법률자문을 대신하지 않습니다.",
                    color = Muted,
                    fontSize = 11.sp
                )

                Text("진행 순서", fontWeight = FontWeight.Black)
                Button(
                    onClick = {
                        val updated = contract.copy(
                            debtStatus = "1차 독촉",
                            firstDemandAt = LocalDate.now().toString(),
                            balanceDueDate = originalDueDate,
                            demandDueDate = dueDate,
                            debtMemo = memo
                        )
                        onUpdate(updated)
                        shareDebtDemandText(context, updated)
                    },
                    enabled = remain > 0 && dueValid,
                    modifier = Modifier.fillMaxWidth()
                ) { Text("① 1차 지급요청 문구 보내기") }

                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { showPreview = true }, enabled = canPreviewLegalDocs, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.Visibility, null); Spacer(Modifier.width(4.dp)); Text("미리보기")
                    }
                    OutlinedButton(
                        onClick = {
                            val updated = contract.copy(
                                debtStatus = if (originalDuePassed) "내용증명 준비" else "지급안내 준비",
                                balanceDueDate = originalDueDate,
                                demandDueDate = dueDate,
                                debtMemo = memo
                            )
                            if (shareDebtDocumentPdf(context, updated, "내용증명", businessProfile)) {
                                onUpdate(updated)
                            }
                        },
                        enabled = canCreateLegalDocs,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.PictureAsPdf, null)
                        Spacer(Modifier.width(4.dp))
                        Text(if (originalDuePassed) "② 내용증명 PDF" else "② 사전안내 PDF")
                    }
                }

                OutlinedButton(
                    onClick = {
                        onUpdate(contract.copy(
                            debtStatus = if (originalDuePassed) "내용증명 발송" else "지급안내 발송",
                            certifiedMailAt = LocalDate.now().toString(),
                            balanceDueDate = originalDueDate,
                            demandDueDate = dueDate,
                            debtMemo = memo
                        ))
                        Toast.makeText(
                            context,
                            if (originalDuePassed) "내용증명 발송 상태로 기록했습니다." else "사전 지급안내 발송 상태로 기록했습니다.",
                            Toast.LENGTH_SHORT
                        ).show()
                    },
                    enabled = canCreateLegalDocs && (contract.debtStatus in setOf("지급안내 준비", "지급안내 발송", "내용증명 준비", "내용증명 발송") || contract.certifiedMailAt.isNotBlank()),
                    modifier = Modifier.fillMaxWidth()
                ) { Text(if (originalDuePassed) "③ 내용증명 발송완료로 표시" else "③ 사전안내 발송완료로 표시") }

                OutlinedButton(
                    onClick = {
                        val updated = contract.copy(
                            debtStatus = "소송 준비",
                            legalPreparedAt = LocalDate.now().toString(),
                            balanceDueDate = originalDueDate,
                            demandDueDate = dueDate,
                            debtMemo = memo
                        )
                        if (shareDebtDocumentPdf(context, updated, "소액소송 준비자료", businessProfile)) {
                            onUpdate(updated)
                        }
                    },
                    enabled = canCreateLegalDocs && originalDuePassed && contract.certifiedMailAt.isNotBlank(),
                    modifier = Modifier.fillMaxWidth()
                ) { Text("④ 전자소액재판 준비자료 PDF") }

                Text("증빙 체크", fontWeight = FontWeight.Black)
                Text(mark(contract.signed, "체결된 계약서"), fontSize = 12.sp, color = if (contract.signed) Muted else MaterialTheme.colorScheme.error)
                Text(mark(contract.paidAmount >= 0, "입금/미수금 계산내역"), fontSize = 12.sp, color = Muted)
                Text(mark(contract.firstDemandAt.isNotBlank(), "1차 지급요청 기록"), fontSize = 12.sp, color = if (contract.firstDemandAt.isNotBlank()) Muted else MaterialTheme.colorScheme.error)
                Text(mark(contract.certifiedMailAt.isNotBlank(), "내용증명 발송 기록"), fontSize = 12.sp, color = if (contract.certifiedMailAt.isNotBlank()) Muted else MaterialTheme.colorScheme.error)
                Text(mark(contract.signatureName.isNotBlank() || contract.signedAt.isNotBlank(), "전자서명 기록"), fontSize = 12.sp, color = if (contract.signatureName.isNotBlank() || contract.signedAt.isNotBlank()) Muted else MaterialTheme.colorScheme.error)

                OutlinedButton(
                    onClick = {
                        try { context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://ecfs.scourt.go.kr"))) }
                        catch (_: Exception) { Toast.makeText(context, "전자소송포털을 열 수 없습니다.", Toast.LENGTH_SHORT).show() }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("⑤ 대한민국 법원 전자소송포털 열기") }
                Text("※ 앱은 자료 정리와 문서 작성을 돕는 기능입니다. 실제 청구내용, 지연손해금, 관할법원 등은 사건별로 확인해야 합니다.", color = Muted, fontSize = 11.sp)
            }
        },
        confirmButton = { TextButton(onClick = { onUpdate(contract.copy(balanceDueDate = originalDueDate, demandDueDate = dueDate, debtMemo = memo)); onDismiss() }) { Text("저장·닫기") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("닫기") } }
    )

    if (showPreview) {
        val previewContract = contract.copy(balanceDueDate = originalDueDate, demandDueDate = dueDate, debtMemo = memo)
        AlertDialog(
            onDismissRequest = { showPreview = false },
            title = { Text(if (originalDuePassed) "내용증명 미리보기" else "사전 지급안내 미리보기", fontWeight = FontWeight.Black) },
            text = {
                Text(
                    buildDebtNoticeText(previewContract, businessProfile),
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    fontSize = 13.sp
                )
            },
            confirmButton = { TextButton(onClick = { showPreview = false }) { Text("확인") } }
        )
    }
}

private fun buildDebtNoticeText(c: Contract, business: BusinessProfile): String {
    val remain = (c.amount - c.paidAmount).coerceAtLeast(0)
    val senderName = business.businessName.ifBlank { business.representative.ifBlank { "발신인" } }
    val account = listOf(business.bankName, business.accountNumber, business.accountHolder).filter { it.isNotBlank() }.joinToString(" ")
    val originalDue = runCatching { LocalDate.parse(c.balanceDueDate) }.getOrNull()
    val isOverdue = originalDue?.isBefore(LocalDate.now()) == true
    val documentTitle = if (isOverdue) "미지급 공사·용역대금 지급 최고 및 법적 절차 예고" else "공사·용역대금 지급기일 사전 안내"
    return buildString {
        appendLine(documentTitle)
        appendLine("내 용 증 명")
        appendLine("문서번호: ${c.id}")
        appendLine()
        appendLine("1. 수신인")
        appendLine("성명: ${c.customer}")
        appendLine("주소: ${c.address.ifBlank { "미등록" }}")
        appendLine("연락처: ${c.phone.ifBlank { "미등록" }}")
        appendLine()
        appendLine("2. 발신인")
        appendLine("상호: $senderName")
        appendLine("대표자: ${business.representative.ifBlank { "미등록" }}")
        if (business.registrationNo.isNotBlank()) appendLine("사업자등록번호: ${business.registrationNo}")
        appendLine("주소: ${business.fullAddress.ifBlank { "미등록" }}")
        appendLine("연락처: ${business.phone.ifBlank { "미등록" }}")
        appendLine()
        appendLine("제목: ${c.item.ifBlank { "공사·용역" }} ${if (isOverdue) "미지급 잔금 지급 최고" else "잔금 지급기일 사전 안내"}")
        appendLine()
        appendLine("1. 계약 및 채권 발생 경위")
        appendLine("귀하와 발신인은 ${c.contractDate} ${c.item.ifBlank { "공사·용역" }}에 관한 계약을 체결하였습니다. 발신인은 계약에 따른 제품 공급 또는 공사·용역을 이행하였으며, 계약상 지급내역은 다음과 같습니다.")
        appendLine("계약일: ${c.contractDate}")
        appendLine("계약번호: ${c.id}")
        appendLine("거래내용: ${c.item}")
        appendLine("총 계약금액: ${won(c.amount)}")
        appendLine("기지급금액: ${won(c.paidAmount)}")
        appendLine("미지급금액: ${won(remain)}")
        appendLine("약정 잔금 지급일: ${c.balanceDueDate.ifBlank { "미등록" }}")
        appendLine()
        appendLine(if (isOverdue) "2. 미지급 잔금 지급 최고" else "2. 잔금 지급기일 사전 안내")
        appendLine(
            if (isOverdue) {
                "발신인은 귀하에게 미지급 잔금 ${won(remain)} 전액을 ${c.demandDueDate.ifBlank { "지정 기한" }}까지 지급할 것을 정식으로 최고합니다."
            } else {
                "계약상 잔금 ${won(remain)}의 약정 지급일은 ${c.balanceDueDate.ifBlank { "지정 기한" }}입니다. 원활한 정산을 위하여 해당 지급일까지 잔금을 지급하여 주시기 바랍니다."
            }
        )
        if (account.isNotBlank()) appendLine("입금계좌: $account") else appendLine("입금계좌: 발신인에게 확인")
        appendLine("이미 지급하였거나 청구금액에 이의가 있는 경우에는 본 내용증명을 받은 날부터 3일 이내에 입금확인증 또는 이의 사유와 관련 증빙자료를 제출하여 주시기 바랍니다.")
        appendLine()
        appendLine("3. 법적 근거 및 지연손해금")
        appendLine(
            if (isOverdue) {
                "민법 제387조에 따라 이행기한이 정하여진 채무는 그 기한이 도래한 때부터 이행지체 책임이 발생할 수 있습니다. 또한 민법 제390조에 따라 채무의 내용에 좇은 이행이 이루어지지 않은 경우 손해배상을 청구할 수 있으며, 금전채무 불이행에 대해서는 민법 제397조에 따라 적법한 약정이율 또는 관계 법령상 법정이율에 의한 지연손해금이 발생할 수 있습니다."
            } else {
                "현재 약정 지급기일 전이므로 본 문서는 지급금액과 지급일을 사전에 안내하기 위한 것입니다. 약정 지급기일이 지난 후에도 지급되지 않는 경우 민법 제387조·제390조·제397조 및 계약 내용에 따라 이행지체, 손해배상과 지연손해금 문제가 발생할 수 있습니다."
            }
        )
        appendLine()
        appendLine(if (isOverdue) "4. 법적 절차 진행 예고" else "4. 지급기일 이후 미지급 시 예정 절차")
        appendLine("약정 지급기일과 최종 지급기한이 지난 후에도 지급 또는 합리적인 협의가 이루어지지 않을 경우 발신인은 관할법원에 지급명령 신청, 소액사건심판 또는 민사소송 제기, 필요한 경우 가압류 등 채권보전조치, 확정된 집행권원에 기초한 강제집행 절차를 진행하고 미지급 원금·지연손해금 및 법령상 인정되는 범위의 소송비용을 청구할 수 있습니다.")
        appendLine()
        appendLine("5. 권리보전 통지")
        appendLine("본 내용증명은 미지급 대금의 지급을 공식적으로 최고하고 관련 사실관계를 명확히 남기기 위한 것입니다. 본 문서에 기재되지 않은 사항이 있다고 하여 발신인이 계약 또는 법령에 따라 보유하는 다른 권리를 포기한 것으로 해석되지 않습니다.")
        if (c.debtMemo.isNotBlank()) { appendLine(); appendLine("추가사항: ${c.debtMemo}") }
        appendLine()
        appendLine("발신일: ${LocalDate.now()}")
        appendLine("발신인: $senderName")
        append("대표자: ${business.representative.ifBlank { "미등록" }} (서명 또는 인)")
    }.trim()
}

private fun shareDebtDemandText(context: Context, c: Contract) {
    val remain = (c.amount - c.paidAmount).coerceAtLeast(0)
    val business = loadBusinessProfile(context)
    val senderName = business.businessName.ifBlank { business.representative.ifBlank { "ONEBIZ" } }
    val text = """[$senderName 미수금 지급요청]
${c.customer} 고객님, 계약번호 ${c.id} 관련 미지급 대금 ${won(remain)}이 확인됩니다.
총 계약금액: ${won(c.amount)}
입금액: ${won(c.paidAmount)}
미수금: ${won(remain)}
최종 지급요청일: ${c.demandDueDate.ifBlank { "미정" }}

위 기한까지 지급 또는 지급일정 협의를 부탁드립니다. 미지급이 계속되는 경우 내용증명 발송 및 민사상 청구절차를 검토할 수 있습니다.
$senderName""".trimIndent()
    try {
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            setType("text/plain"); putExtra(Intent.EXTRA_TEXT, text)
        }, "지급요청 보내기"))
    } catch (_: Exception) { Toast.makeText(context, "공유 앱을 열 수 없습니다.", Toast.LENGTH_SHORT).show() }
}

private fun shareDebtDocumentPdf(context: Context, c: Contract, type: String, business: BusinessProfile = loadBusinessProfile(context)): Boolean {
    return try {
        val remain = (c.amount - c.paidAmount).coerceAtLeast(0)
        val originalDue = runCatching { LocalDate.parse(c.balanceDueDate) }.getOrNull()
        val isOverdue = originalDue?.isBefore(LocalDate.now()) == true
        val pdf = PdfDocument()
        if (type == "내용증명") {
            val pageWidth = 595f
            val pageHeight = 842f
            val left = 44f
            val right = 551f
            val contentWidth = right - left
            val navy = android.graphics.Color.rgb(28, 55, 91)
            val gray = android.graphics.Color.rgb(80, 80, 80)
            val light = android.graphics.Color.rgb(242, 246, 250)
            val border = android.graphics.Color.rgb(165, 174, 184)
            val titlePaint = android.graphics.Paint().apply {
                color = android.graphics.Color.BLACK; textSize = 22f; isFakeBoldText = true
                textAlign = android.graphics.Paint.Align.CENTER; isAntiAlias = true
            }
            val subtitlePaint = android.graphics.Paint().apply {
                color = navy; textSize = 12f; isFakeBoldText = true
                textAlign = android.graphics.Paint.Align.CENTER; isAntiAlias = true
            }
            val sectionPaint = android.graphics.Paint().apply {
                color = navy; textSize = 13f; isFakeBoldText = true; isAntiAlias = true
            }
            val body = android.graphics.Paint().apply {
                color = gray; textSize = 10.5f; isAntiAlias = true
            }
            val bodyBold = android.graphics.Paint(body).apply {
                color = android.graphics.Color.BLACK; isFakeBoldText = true
            }
            val small = android.graphics.Paint(body).apply { textSize = 8.5f }
            val linePaint = android.graphics.Paint().apply {
                color = border; style = android.graphics.Paint.Style.STROKE; strokeWidth = 0.8f; isAntiAlias = true
            }
            val fillPaint = android.graphics.Paint().apply { color = light; style = android.graphics.Paint.Style.FILL }

            fun wrapped(canvas: android.graphics.Canvas, text: String, paint: android.graphics.Paint, x: Float, startY: Float, maxWidth: Float, lineHeight: Float = 15f): Float {
                var drawY = startY
                text.split("\n").forEach { paragraph ->
                    if (paragraph.isEmpty()) {
                        drawY += lineHeight
                    } else {
                        var line = ""
                        paragraph.forEach { ch ->
                            val candidate = line + ch
                            if (line.isNotEmpty() && paint.measureText(candidate) > maxWidth) {
                                canvas.drawText(line, x, drawY, paint)
                                drawY += lineHeight
                                line = ch.toString()
                            } else {
                                line = candidate
                            }
                        }
                        if (line.isNotEmpty()) {
                            canvas.drawText(line, x, drawY, paint)
                            drawY += lineHeight
                        }
                    }
                }
                return drawY
            }

            fun footer(canvas: android.graphics.Canvas, pageNo: Int) {
                canvas.drawLine(left, pageHeight - 35f, right, pageHeight - 35f, linePaint)
                canvas.drawText("ONEBIZ 자동작성 문서 · 원본 및 발송·배달증명은 별도 보관", left, pageHeight - 20f, small)
                small.textAlign = android.graphics.Paint.Align.RIGHT
                canvas.drawText("$pageNo / 2", right, pageHeight - 20f, small)
                small.textAlign = android.graphics.Paint.Align.LEFT
            }

            fun section(canvas: android.graphics.Canvas, number: String, title: String, y: Float): Float {
                canvas.drawText("$number. $title", left, y, sectionPaint)
                canvas.drawLine(left, y + 6f, right, y + 6f, linePaint)
                return y + 24f
            }

            val senderName = business.businessName.ifBlank { business.representative.ifBlank { "발신인" } }
            val account = listOf(business.bankName, business.accountNumber, business.accountHolder).filter { it.isNotBlank() }.joinToString(" ")
            val documentTitle = if (isOverdue) "미지급 공사·용역대금 지급 최고 및 법적 절차 예고" else "공사·용역대금 지급기일 사전 안내"

            val page1 = pdf.startPage(PdfDocument.PageInfo.Builder(pageWidth.toInt(), pageHeight.toInt(), 1).create())
            val canvas1 = page1.canvas
            var y = 52f
            canvas1.drawText("내  용  증  명", pageWidth / 2f, y, titlePaint)
            y += 24f
            canvas1.drawText(documentTitle, pageWidth / 2f, y, subtitlePaint)
            y += 24f
            small.textAlign = android.graphics.Paint.Align.RIGHT
            canvas1.drawText("문서번호 ${c.id}", right, y, small)
            small.textAlign = android.graphics.Paint.Align.LEFT
            y += 18f

            canvas1.drawRect(left, y, right, y + 82f, fillPaint)
            canvas1.drawRect(left, y, right, y + 82f, linePaint)
            canvas1.drawText("수신인", left + 10f, y + 18f, bodyBold)
            canvas1.drawText("성명  ${c.customer}", left + 74f, y + 18f, body)
            canvas1.drawText("연락처  ${c.phone.ifBlank { "미등록" }}", left + 280f, y + 18f, body)
            wrapped(canvas1, "주소  ${c.address.ifBlank { "미등록" }}", body, left + 74f, y + 40f, contentWidth - 90f, 14f)
            y += 92f

            canvas1.drawRect(left, y, right, y + 100f, linePaint)
            canvas1.drawText("발신인", left + 10f, y + 18f, bodyBold)
            canvas1.drawText("상호  $senderName", left + 74f, y + 18f, body)
            canvas1.drawText("대표자  ${business.representative.ifBlank { "미등록" }}", left + 280f, y + 18f, body)
            canvas1.drawText("사업자등록번호  ${business.registrationNo.ifBlank { "해당 없음" }}", left + 74f, y + 40f, body)
            canvas1.drawText("연락처  ${business.phone.ifBlank { "미등록" }}", left + 280f, y + 40f, body)
            wrapped(canvas1, "주소  ${business.fullAddress.ifBlank { "미등록" }}", body, left + 74f, y + 62f, contentWidth - 90f, 14f)
            y += 116f

            y = section(canvas1, "1", "계약 및 채권 발생 경위", y)
            y = wrapped(
                canvas1,
                "귀하와 발신인은 ${c.contractDate} ${c.item.ifBlank { "공사·용역" }}에 관한 계약을 체결하였습니다. 발신인은 계약에 따른 제품 공급 또는 공사·용역을 이행하였으며, 계약상 지급내역은 다음과 같습니다.",
                body, left, y, contentWidth, 15f
            ) + 7f

            val tableTop = y
            val rowH = 25f
            val labelW = 150f
            val rows = listOf(
                "계약번호 / 계약일" to "${c.id} / ${c.contractDate}",
                "공사·용역 내용" to c.item.ifBlank { "미등록" },
                "총 계약금액" to won(c.amount),
                "기지급금액" to won(c.paidAmount),
                (if (isOverdue) "미지급 잔금" else "지급예정 잔금") to won(remain),
                "약정 잔금 지급일" to c.balanceDueDate.ifBlank { "미등록" }
            )
            canvas1.drawRect(left, tableTop, right, tableTop + rowH * rows.size, linePaint)
            canvas1.drawLine(left + labelW, tableTop, left + labelW, tableTop + rowH * rows.size, linePaint)
            rows.forEachIndexed { index, (label, value) ->
                val top = tableTop + rowH * index
                if (index > 0) canvas1.drawLine(left, top, right, top, linePaint)
                canvas1.drawRect(left, top, left + labelW, top + rowH, fillPaint)
                canvas1.drawText(label, left + 8f, top + 17f, bodyBold)
                canvas1.drawText(value, left + labelW + 9f, top + 17f, if (label == "미지급 잔금" || label == "지급예정 잔금") bodyBold else body)
            }
            y = tableTop + rowH * rows.size + 24f

            y = section(canvas1, "2", if (isOverdue) "미지급 잔금 지급 최고" else "잔금 지급기일 사전 안내", y)
            y = wrapped(
                canvas1,
                if (isOverdue) {
                    "발신인은 귀하에게 미지급 잔금 ${won(remain)} 전액을 ${c.demandDueDate.ifBlank { "지정 기한" }}까지 지급할 것을 정식으로 최고합니다."
                } else {
                    "계약상 잔금 ${won(remain)}의 약정 지급일은 ${c.balanceDueDate.ifBlank { "지정 기한" }}입니다. 원활한 정산을 위하여 해당 지급일까지 잔금을 지급하여 주시기 바랍니다."
                },
                bodyBold, left, y, contentWidth, 16f
            )
            y = wrapped(canvas1, "입금계좌: ${account.ifBlank { "발신인에게 확인" }}", body, left, y + 3f, contentWidth, 15f)
            wrapped(
                canvas1,
                "이미 지급하였거나 청구금액에 이의가 있는 경우에는 본 내용증명을 받은 날부터 3일 이내에 입금확인증 또는 이의 사유와 관련 증빙자료를 발신인에게 제출하여 주시기 바랍니다.",
                body, left, y + 3f, contentWidth, 15f
            )
            footer(canvas1, 1)
            pdf.finishPage(page1)

            val page2 = pdf.startPage(PdfDocument.PageInfo.Builder(pageWidth.toInt(), pageHeight.toInt(), 2).create())
            val canvas2 = page2.canvas
            y = 48f
            canvas2.drawText(if (isOverdue) "미지급 공사·용역대금 지급 최고서" else "공사·용역대금 지급기일 사전 안내서", pageWidth / 2f, y, subtitlePaint)
            y += 34f
            y = section(canvas2, "3", "법적 근거 및 지연손해금", y)
            y = wrapped(
                canvas2,
                if (isOverdue) {
                    "민법 제387조에 따라 이행기한이 정하여진 채무는 그 기한이 도래한 때부터 이행지체 책임이 발생할 수 있습니다. 또한 민법 제390조에 따라 채무의 내용에 좇은 이행이 이루어지지 않은 경우 손해배상을 청구할 수 있습니다."
                } else {
                    "현재 약정 지급기일 전이므로 본 문서는 지급금액과 지급일을 사전에 안내하기 위한 것입니다. 약정 지급기일이 지난 후에도 지급되지 않는 경우 민법 제387조와 제390조에 따른 이행지체 및 손해배상 문제가 발생할 수 있습니다."
                },
                body, left, y, contentWidth, 16f
            )
            y = wrapped(
                canvas2,
                if (isOverdue) {
                    "금전채무의 불이행에 대해서는 민법 제397조에 따라 계약에서 정한 적법한 약정이율이 있는 경우 그 약정에 따르고, 별도의 약정이 없는 경우 해당 거래관계에 적용되는 법정이율에 의한 지연손해금이 발생할 수 있습니다."
                } else {
                    "약정 지급기일 경과 후 금전채무가 이행되지 않으면 민법 제397조에 따라 적법한 약정이율 또는 해당 거래관계에 적용되는 법정이율에 의한 지연손해금이 발생할 수 있습니다."
                },
                body, left, y + 5f, contentWidth, 16f
            ) + 12f

            y = section(canvas2, "4", if (isOverdue) "법적 절차 진행 예고" else "지급기일 이후 미지급 시 예정 절차", y)
            y = wrapped(
                canvas2,
                if (isOverdue) {
                    "귀하가 최종 지급기한까지 미지급 대금을 지급하지 않거나 합리적인 협의 요청을 하지 않는 경우, 발신인은 별도의 추가 통보 없이 다음 절차의 전부 또는 일부를 진행할 수 있음을 알려드립니다."
                } else {
                    "약정 지급기일과 최종 지급기한이 지난 후에도 대금 지급 또는 합리적인 협의가 이루어지지 않는 경우 다음 절차의 전부 또는 일부가 진행될 수 있음을 사전에 알려드립니다."
                },
                body, left, y, contentWidth, 16f
            ) + 4f
            listOf(
                "1) 민사소송법 제462조에 따른 지급명령 신청",
                "2) 소액사건심판 또는 공사·용역대금 청구소송 제기",
                "3) 필요한 경우 채권보전을 위한 가압류 신청",
                "4) 미지급 원금, 지연손해금 및 법령상 인정되는 범위의 소송비용 청구",
                "5) 확정된 지급명령 또는 판결 등 집행권원에 기초한 강제집행"
            ).forEach { item -> y = wrapped(canvas2, item, body, left + 8f, y, contentWidth - 8f, 16f) }
            y += 12f

            y = section(canvas2, "5", "권리보전 통지", y)
            y = wrapped(
                canvas2,
                "본 내용증명은 미지급 대금의 지급을 공식적으로 최고하고 관련 사실관계를 명확히 남기기 위한 것입니다. 본 문서에 기재되지 않은 사항이 있다고 하여 발신인이 계약 또는 법령에 따라 보유하는 다른 권리를 포기한 것으로 해석되지 않습니다.",
                body, left, y, contentWidth, 16f
            )
            if (c.debtMemo.isNotBlank()) {
                y = wrapped(canvas2, "추가사항: ${c.debtMemo}", body, left, y + 5f, contentWidth, 16f)
            }
            y += 12f

            y = section(canvas2, "6", "첨부 및 보관자료", y)
            y = wrapped(
                canvas2,
                "계약서·견적서·거래명세서, 공사 또는 납품 완료자료, 기존 입금내역, 문자·카카오톡 등 지급요청 기록, 내용증명 발송 및 배달증명 자료",
                body, left, y, contentWidth, 16f
            ) + 16f

            body.textAlign = android.graphics.Paint.Align.RIGHT
            bodyBold.textAlign = android.graphics.Paint.Align.RIGHT
            canvas2.drawText("발신일: ${LocalDate.now()}", right, y, body)
            y += 24f
            canvas2.drawText("발신인: $senderName", right, y, bodyBold)
            y += 22f
            canvas2.drawText("대표자: ${business.representative.ifBlank { "미등록" }}   (서명 또는 인)", right, y, body)
            body.textAlign = android.graphics.Paint.Align.LEFT
            bodyBold.textAlign = android.graphics.Paint.Align.LEFT
            footer(canvas2, 2)
            pdf.finishPage(page2)
        } else {
            val page = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
            val canvas = page.canvas
            val titlePaint = android.graphics.Paint().apply { color = android.graphics.Color.BLACK; textSize = 18f; isFakeBoldText = true; isAntiAlias = true }
            val body = android.graphics.Paint().apply { color = android.graphics.Color.DKGRAY; textSize = 12f; isAntiAlias = true }
            var y = 60f
            fun line(t: String, gap: Float = 24f) { canvas.drawText(t.take(74), 45f, y, body); y += gap }
            canvas.drawText("${business.businessName.ifBlank { business.representative.ifBlank { "발신인" } }} $type", 45f, y, titlePaint); y += 38f
            line("계약번호: ${c.id}"); line("수신인: ${c.customer}"); line("주소: ${c.address}")
            line("계약일: ${c.contractDate}"); line("공사/용역: ${c.item}")
            line("총 계약금액: ${won(c.amount)}"); line("기지급금액: ${won(c.paidAmount)}"); line("미지급금액: ${won(remain)}")
            y += 16f; canvas.drawText("전자소송 준비 체크리스트", 45f, y, titlePaint); y += 30f
            listOf("1. 계약서 및 전자서명 완료기록", "2. 견적서 및 거래명세서", "3. 입금내역 및 미수금 계산표", "4. 내용증명과 발송·배달증명", "5. 카카오톡·문자 등 지급요청 기록", "6. 시공완료 사진 및 인수 관련 자료").forEach { line(it) }
            y += 8f; line("청구원금(참고): ${won(remain)}")
            line("※ 지연손해금, 관할법원, 청구취지는 사건별 확인 후 전자소송포털에 입력하세요.")
            if (c.debtMemo.isNotBlank()) { y += 10f; line("메모: ${c.debtMemo}") }
            pdf.finishPage(page)
        }
        val outputType = if (type == "내용증명" && !isOverdue) "사전지급안내" else type
        val dir = java.io.File(context.cacheDir, "docs").apply { mkdirs() }
        val file = java.io.File(dir, "${outputType}_${c.id}.pdf")
        java.io.FileOutputStream(file).use { pdf.writeTo(it) }; pdf.close()
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            setType("application/pdf"); putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "$outputType 공유"))
        true
    } catch (e: Exception) {
        Toast.makeText(context, "$type 생성 실패: ${e.message ?: "오류"}", Toast.LENGTH_LONG).show(); false
    }
}

private fun openHometax(context: Context, type: String) {
    try {
        Toast.makeText(context, "$type 발행을 위해 홈택스를 엽니다. 자동발행 API는 사업자 인증 연동 후 적용할 수 있습니다.", Toast.LENGTH_LONG).show()
        val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.hometax.go.kr"))
        context.startActivity(intent)
    } catch (_: Exception) {
        Toast.makeText(context, "홈택스를 열 수 없습니다.", Toast.LENGTH_SHORT).show()
    }
}

private fun paymentPdfPaint(
    color: Int,
    size: Float,
    bold: Boolean = false,
    align: android.graphics.Paint.Align = android.graphics.Paint.Align.LEFT
) = android.graphics.Paint().apply {
    this.color = color
    textSize = size
    isFakeBoldText = bold
    textAlign = align
    isAntiAlias = true
}

private fun fitPaymentPdfText(text: String, paint: android.graphics.Paint, maxWidth: Float): String {
    if (paint.measureText(text) <= maxWidth) return text
    var value = text
    while (value.length > 1 && paint.measureText("$value…") > maxWidth) value = value.dropLast(1)
    return "$value…"
}

private fun drawPaymentPdfCell(
    canvas: android.graphics.Canvas,
    text: String,
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
    background: Int = android.graphics.Color.WHITE,
    textColor: Int = android.graphics.Color.rgb(25, 23, 31),
    textSize: Float = 9f,
    bold: Boolean = false,
    align: android.graphics.Paint.Align = android.graphics.Paint.Align.LEFT,
    borderColor: Int = android.graphics.Color.rgb(217, 212, 225)
) {
    val fill = android.graphics.Paint().apply { color = background; style = android.graphics.Paint.Style.FILL }
    val border = android.graphics.Paint().apply { color = borderColor; style = android.graphics.Paint.Style.STROKE; strokeWidth = 0.75f; isAntiAlias = true }
    canvas.drawRect(left, top, right, bottom, fill)
    canvas.drawRect(left, top, right, bottom, border)
    val paint = paymentPdfPaint(textColor, textSize, bold, align)
    val padding = 6f
    val x = when (align) {
        android.graphics.Paint.Align.CENTER -> (left + right) / 2f
        android.graphics.Paint.Align.RIGHT -> right - padding
        else -> left + padding
    }
    val baseline = (top + bottom - paint.fontMetrics.ascent - paint.fontMetrics.descent) / 2f
    canvas.drawText(fitPaymentPdfText(text, paint, (right - left) - padding * 2), x, baseline, paint)
}

private fun drawCompanyElectronicSeal(
    canvas: android.graphics.Canvas,
    centerX: Float,
    centerY: Float,
    profile: BusinessProfile,
    radius: Float = 23f
): Boolean {
    val businessName = profile.businessName.trim()
    val representative = profile.representative.trim()
    if (businessName.isBlank() && representative.isBlank()) return false

    val sealRed = android.graphics.Color.rgb(196, 58, 58)
    val ring = android.graphics.Paint().apply {
        color = sealRed
        style = android.graphics.Paint.Style.STROKE
        strokeWidth = 1.5f
        isAntiAlias = true
    }
    canvas.drawCircle(centerX, centerY, radius, ring)
    canvas.drawCircle(centerX, centerY, radius - 3.2f, ring.apply { strokeWidth = 0.75f })

    val compactName = businessName.filterNot { it.isWhitespace() }.ifBlank { "원비즈" }.take(10)
    val firstLine: String
    val secondLine: String
    if (compactName.length <= 4) {
        firstLine = compactName
        secondLine = ""
    } else {
        val split = (compactName.length + 1) / 2
        firstLine = compactName.take(split)
        secondLine = compactName.drop(split)
    }

    canvas.drawText("전자직인", centerX, centerY - 12f, paymentPdfPaint(sealRed, 5.5f, true, android.graphics.Paint.Align.CENTER))
    if (secondLine.isBlank()) {
        canvas.drawText(firstLine, centerX, centerY + 2f, paymentPdfPaint(sealRed, 8f, true, android.graphics.Paint.Align.CENTER))
    } else {
        canvas.drawText(firstLine, centerX, centerY - 2f, paymentPdfPaint(sealRed, 7f, true, android.graphics.Paint.Align.CENTER))
        canvas.drawText(secondLine, centerX, centerY + 7f, paymentPdfPaint(sealRed, 7f, true, android.graphics.Paint.Align.CENTER))
    }
    val representativeLabel = if (representative.isBlank()) "대표" else "대표 ${representative.take(4)}"
    canvas.drawText(representativeLabel, centerX, centerY + 16f, paymentPdfPaint(sealRed, 5.5f, true, android.graphics.Paint.Align.CENTER))
    return true
}

private fun koreanReceiptAmount(amount: Int): String {
    if (amount <= 0) return "영원"
    val digits = arrayOf("", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구")
    val smallUnits = arrayOf("", "십", "백", "천")
    val largeUnits = arrayOf("", "만", "억", "조")
    fun groupText(group: Int): String {
        if (group == 0) return ""
        val result = StringBuilder()
        for (position in 3 downTo 0) {
            val divisor = when (position) { 3 -> 1000; 2 -> 100; 1 -> 10; else -> 1 }
            val digit = (group / divisor) % 10
            if (digit == 0) continue
            if (!(digit == 1 && position > 0)) result.append(digits[digit])
            result.append(smallUnits[position])
        }
        return result.toString()
    }
    var remaining = amount.toLong()
    var groupIndex = 0
    val parts = mutableListOf<String>()
    while (remaining > 0 && groupIndex < largeUnits.size) {
        val group = (remaining % 10000).toInt()
        if (group > 0) parts.add(0, groupText(group) + largeUnits[groupIndex])
        remaining /= 10000
        groupIndex++
    }
    return parts.joinToString("") + "원"
}

/** Separate the quote's real item amounts from a contract's already-settled amounts. */
private fun quoteStatementPdfCells(quote: Quote, item: QuoteItem): List<String> {
    val amounts = calculateQuoteAmounts(listOf(PriceLine(item.qty, item.unitPrice)), 0.0, quote.vatEnabled, quote.pricingVersion)
    val supply = if (quote.usesVatIncludedPricing && quote.vatEnabled) amounts.discountedSupply - amounts.vat else amounts.discountedSupply
    return listOf(
        quote.createdAt,
        item.name,
        item.spec.ifBlank { "-" },
        decimalInputText(item.qty),
        won(item.unitPrice),
        won(supply),
        if (quote.vatEnabled) won(amounts.vat) else "별도",
        won(amounts.total)
    )
}

private fun drawQuoteStatementAppendix(canvas: android.graphics.Canvas, quote: Quote, pageIndex: Int, totalPages: Int, rows: List<QuoteItem>) {
    val purple = android.graphics.Color.rgb(91, 67, 214)
    val ink = android.graphics.Color.rgb(25, 23, 31)
    val muted = android.graphics.Color.rgb(110, 104, 118)
    val left = 42f
    val right = 553f
    canvas.drawRect(0f, 0f, 595f, 13f, android.graphics.Paint().apply { color = purple })
    canvas.drawText("거래명세서 · 품목 별지", left, 69f, paymentPdfPaint(ink, 21f, true))
    canvas.drawText("견적번호 ${quote.id} · ${quote.customer}", left, 95f, paymentPdfPaint(muted, 10f))
    canvas.drawText("${pageIndex} / ${totalPages}", right, 95f, paymentPdfPaint(purple, 10f, true, android.graphics.Paint.Align.RIGHT))
    val columns = floatArrayOf(left, 102f, 217f, 265f, 301f, 365f, 435f, 493f, right)
    val headers = listOf("거래일", "품목명", "규격", "수량", "단가", "공급가액", "부가세", "합계")
    headers.indices.forEach { i ->
        drawPaymentPdfCell(canvas, headers[i], columns[i], 127f, columns[i + 1], 157f, purple, android.graphics.Color.WHITE, 7.5f, true, android.graphics.Paint.Align.CENTER)
    }
    rows.forEachIndexed { row, item ->
        val values = quoteStatementPdfCells(quote, item)
        val top = 157f + row * 30f
        values.indices.forEach { i ->
            drawPaymentPdfCell(canvas, values[i], columns[i], top, columns[i + 1], top + 30f,
                if (row % 2 == 0) android.graphics.Color.WHITE else android.graphics.Color.rgb(249, 248, 252), ink,
                7.2f, i == 7, if (i >= 3) android.graphics.Paint.Align.RIGHT else if (i == 0 || i == 2) android.graphics.Paint.Align.CENTER else android.graphics.Paint.Align.LEFT)
        }
    }
    canvas.drawLine(left, 793f, right, 793f, android.graphics.Paint().apply { color = purple; strokeWidth = 1f })
    canvas.drawText("※ 품목별 금액은 할인 전 기준이며, 최종 정산금액은 첫 페이지를 확인하세요.", left, 812f, paymentPdfPaint(muted, 8f))
}

private fun drawTransactionStatementPdf(
    canvas: android.graphics.Canvas,
    contract: Contract,
    profile: BusinessProfile,
    quote: Quote? = null
) {
    val purple = android.graphics.Color.rgb(91, 67, 214)
    val purpleDark = android.graphics.Color.rgb(51, 36, 143)
    val purpleSoft = android.graphics.Color.rgb(241, 237, 255)
    val ink = android.graphics.Color.rgb(25, 23, 31)
    val muted = android.graphics.Color.rgb(110, 104, 118)
    val light = android.graphics.Color.rgb(248, 247, 251)
    val redSoft = android.graphics.Color.rgb(255, 241, 238)
    val red = android.graphics.Color.rgb(198, 74, 57)
    val left = 42f
    val right = 553f
    val width = right - left

    canvas.drawRect(0f, 0f, 595f, 13f, android.graphics.Paint().apply { color = purple })
    canvas.drawText("ONEBIZ | 원비즈", left, 45f, paymentPdfPaint(purple, 10f, true))
    canvas.drawText("거 래 명 세 서", 297.5f, 71f, paymentPdfPaint(ink, 25f, true, android.graphics.Paint.Align.CENTER))
    canvas.drawText("거래내역 확인 및 대금 정산용", 297.5f, 91f, paymentPdfPaint(muted, 8.5f, false, android.graphics.Paint.Align.CENTER))

    drawPaymentPdfCell(canvas, "거래번호", left, 110f, 122f, 140f, light, muted, 8f, false, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, contract.id, 122f, 110f, 300f, 140f)
    drawPaymentPdfCell(canvas, "작성일", 300f, 110f, 380f, 140f, light, muted, 8f, false, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, LocalDate.now().toString(), 380f, 110f, right, 140f)

    canvas.drawText("공급자 · 공급받는 자 정보", left, 165f, paymentPdfPaint(ink, 12f, true))
    val half = width / 2f
    val mid = left + half
    drawPaymentPdfCell(canvas, "공급자", left, 176f, mid, 202f, purple, android.graphics.Color.WHITE, 10f, true, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, "공급받는 자", mid, 176f, right, 202f, purpleDark, android.graphics.Color.WHITE, 10f, true, android.graphics.Paint.Align.CENTER)
    val supplierRows = listOf(
        "사업자번호" to profile.registrationNo.ifBlank { "-" },
        "상호" to profile.businessName.ifBlank { "원비즈 사용자" },
        "대표자" to profile.representative.ifBlank { "-" },
        "사업장 주소" to profile.fullAddress.ifBlank { "-" },
        "업태·종목" to "공사·납품·서비스",
        "연락처" to profile.phone.ifBlank { "-" }
    )
    val customerRows = listOf(
        "상호·성명" to contract.customer,
        "연락처" to contract.phone.ifBlank { "-" },
        "주소" to contract.address.ifBlank { "-" },
        "현장 주소" to fullSiteAddress(contract).ifBlank { contract.address.ifBlank { "-" } },
        "담당자" to contract.customer,
        "비고" to ""
    )
    val rowHeight = 23f
    val labelWidth = 72f
    supplierRows.indices.forEach { index ->
        val top = 202f + rowHeight * index
        val bottom = top + rowHeight
        val supplier = supplierRows[index]
        val customer = customerRows[index]
        drawPaymentPdfCell(canvas, supplier.first, left, top, left + labelWidth, bottom, light, muted, 7.5f, false, android.graphics.Paint.Align.CENTER)
        drawPaymentPdfCell(canvas, supplier.second, left + labelWidth, top, mid, bottom, android.graphics.Color.WHITE, ink, 8.5f)
        drawPaymentPdfCell(canvas, customer.first, mid, top, mid + labelWidth, bottom, light, muted, 7.5f, false, android.graphics.Paint.Align.CENTER)
        drawPaymentPdfCell(canvas, customer.second, mid + labelWidth, top, right, bottom, android.graphics.Color.WHITE, ink, 8.5f)
    }

    canvas.drawText("거래 내역", left, 360f, paymentPdfPaint(ink, 12f, true))
    val tableTop = 372f
    val columns = floatArrayOf(left, 102f, 217f, 265f, 301f, 365f, 435f, 493f, right)
    val headers = listOf("거래일", "품목명", "규격", "수량", "단가", "공급가액", "부가세", "합계")
    headers.indices.forEach { index ->
        drawPaymentPdfCell(canvas, headers[index], columns[index], tableTop, columns[index + 1], tableTop + 27f, purple, android.graphics.Color.WHITE, 7.5f, true, android.graphics.Paint.Align.CENTER)
    }
    val total = quote?.total ?: contract.amount
    val vat = quote?.vat ?: (contract.amount / 11).coerceAtLeast(0)
    val supply = if (quote == null) (total - vat).coerceAtLeast(0)
        else if (quote.usesVatIncludedPricing && quote.vatEnabled) (quote.discountedSupply - quote.vat).coerceAtLeast(0)
        else quote.discountedSupply
    val items = if (quote != null) quote.items.take(4).map { quoteStatementPdfCells(quote, it) }
        else listOf(listOf(
            contract.contractDate.ifBlank { LocalDate.now().toString() },
            contract.item.ifBlank { "공사·납품·서비스" },
            "-", "1", won(contract.amount), won(supply), won(vat), won(contract.amount)
        ))
    for (row in 0 until 4) {
        val top = tableTop + 27f + row * 26f
        val values = items.getOrNull(row) ?: List(8) { "" }
        values.indices.forEach { index ->
            val align = if (index >= 3) android.graphics.Paint.Align.RIGHT else if (index == 0 || index == 2) android.graphics.Paint.Align.CENTER else android.graphics.Paint.Align.LEFT
            drawPaymentPdfCell(canvas, values[index], columns[index], top, columns[index + 1], top + 26f,
                android.graphics.Color.WHITE, ink, 7.2f, index == 7, align)
        }
    }

    canvas.drawText("금액 정산", left, 528f, paymentPdfPaint(ink, 12f, true))
    val bankName = listOf(profile.bankName, profile.accountNumber, profile.accountHolder).filter { it.isNotBlank() }.joinToString(" ").ifBlank { "입금계좌 미등록" }
    val detailRows = listOf(
        "입금계좌" to bankName,
        "비고" to (if (quote == null) "상기 거래내역과 금액을 확인합니다." else "견적 기준 · 할인 ${won(quote.discountAmount)}"),
        "발행구분" to "□ 영수   □ 청구"
    )
    detailRows.indices.forEach { index ->
        val top = 541f + index * 30f
        drawPaymentPdfCell(canvas, detailRows[index].first, left, top, 112f, top + 30f, purpleSoft, purple, 8f, false, android.graphics.Paint.Align.CENTER)
        drawPaymentPdfCell(canvas, detailRows[index].second, 112f, top, 300f, top + 30f, android.graphics.Color.WHITE, ink, 8f)
    }
    // 견적서만으로는 실제 입금액을 확인할 수 없으므로 0원 입금/전액 미수로 표시하지 않습니다.
    val remaining = (contract.amount - contract.paidAmount).coerceAtLeast(0)
    val totals = listOf(
        Triple("공급가액 합계", won(supply), android.graphics.Color.WHITE),
        Triple("부가가치세", if (quote?.vatEnabled == false) "별도" else won(vat), android.graphics.Color.WHITE),
        Triple("총 거래금액", won(total), purpleSoft),
        Triple("입금액", if (quote == null) won(contract.paidAmount) else "확인 필요", android.graphics.Color.WHITE),
        Triple("미수금", if (quote == null) won(remaining) else "확인 필요", redSoft)
    )
    totals.indices.forEach { index ->
        val top = 541f + index * 24f
        val bg = totals[index].third
        val valueColor = when (index) { 2 -> purple; 4 -> red; else -> ink }
        drawPaymentPdfCell(canvas, totals[index].first, 300f, top, 425f, top + 24f, bg, if (index == 4) red else ink, 8f, index == 2 || index == 4)
        drawPaymentPdfCell(canvas, totals[index].second, 425f, top, right, top + 24f, bg, valueColor, if (index == 2 || index == 4) 10f else 8.5f, index == 2 || index == 4, android.graphics.Paint.Align.RIGHT)
    }
    val taxNote = when {
        quote == null -> "※ 공급가액과 부가가치세는 부가세 포함 금액을 기준으로 자동 계산되었습니다."
        !quote.vatEnabled -> "※ 부가세 별도 · 입금액과 미수금은 대금관리에서 확인하세요."
        else -> "※ 할인 반영 최종 금액 · 입금액과 미수금은 대금관리에서 확인하세요."
    }
    canvas.drawText(taxNote, left, 649f, paymentPdfPaint(muted, 7f))
    if (quote != null && quote.items.size > 4) {
        canvas.drawText("※ 나머지 ${quote.items.size - 4}개 품목은 다음 별지에 이어집니다.", left, 665f, paymentPdfPaint(purple, 7f, true))
    }

    drawPaymentPdfCell(canvas, "공급자 확인", left, 675f, 297.5f, 699f, light, muted, 8.5f, false, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, "공급받는 자 확인", 297.5f, 675f, right, 699f, light, muted, 8.5f, false, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, "", left, 699f, 297.5f, 755f, android.graphics.Color.WHITE, ink, 8.5f, true, android.graphics.Paint.Align.CENTER)
    val supplierConfirmText = listOf(profile.businessName, profile.representative).filter { it.isNotBlank() }.joinToString("  ").ifBlank { "사업자 정보 확인 필요" }
    canvas.drawText(supplierConfirmText, left + 14f, 725f, paymentPdfPaint(ink, 8.5f, true))
    canvas.drawText("전자직인 자동날인", left + 14f, 741f, paymentPdfPaint(muted, 6.8f))
    drawCompanyElectronicSeal(canvas, 270f, 727f, profile, 22f)
    drawPaymentPdfCell(canvas, "${contract.customer}  (서명)", 297.5f, 699f, right, 755f, android.graphics.Color.WHITE, ink, 8.5f, true, android.graphics.Paint.Align.CENTER)

    canvas.drawLine(left, 796f, right, 796f, android.graphics.Paint().apply { color = purple; strokeWidth = 1f })
    canvas.drawText("본 거래명세서는 거래내역 확인용이며 세금계산서를 대신하지 않습니다.", left, 814f, paymentPdfPaint(muted, 7f))
    canvas.drawText("ONEBIZ · 견적부터 계약·서명·대금관리까지 하나로", right, 814f, paymentPdfPaint(purple, 7f, false, android.graphics.Paint.Align.RIGHT))
}

private fun drawSimpleReceiptPdf(
    canvas: android.graphics.Canvas,
    contract: Contract,
    profile: BusinessProfile,
    quote: Quote? = null
) {
    val teal = android.graphics.Color.rgb(20, 134, 109)
    val tealDark = android.graphics.Color.rgb(7, 94, 80)
    val tealSoft = android.graphics.Color.rgb(231, 247, 242)
    val ink = android.graphics.Color.rgb(25, 23, 31)
    val muted = android.graphics.Color.rgb(110, 104, 118)
    val light = android.graphics.Color.rgb(248, 247, 251)
    val left = 42f
    val right = 553f
    val paid = contract.paidAmount.coerceAtLeast(0)
    // 견적서에서 부가세 별도를 선택했다면, 수령액에 임의로 VAT를 포함시키지 않습니다.
    val vat = if (quote?.vatEnabled == false) 0 else paid / 11
    val supply = paid - vat

    canvas.drawRect(0f, 0f, 595f, 13f, android.graphics.Paint().apply { color = teal })
    canvas.drawText("ONEBIZ | 원비즈", left, 45f, paymentPdfPaint(teal, 10f, true))
    canvas.drawText("간 이 영 수 증", 297.5f, 72f, paymentPdfPaint(ink, 25f, true, android.graphics.Paint.Align.CENTER))
    canvas.drawText("SIMPLE RECEIPT", 297.5f, 92f, paymentPdfPaint(muted, 8f, false, android.graphics.Paint.Align.CENTER))

    drawPaymentPdfCell(canvas, "영수증 번호", left, 110f, 122f, 140f, light, muted, 8f, false, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, "R-${contract.id}", 122f, 110f, 300f, 140f)
    drawPaymentPdfCell(canvas, "발행일", 300f, 110f, 380f, 140f, light, muted, 8f, false, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, LocalDate.now().toString(), 380f, 110f, right, 140f)
    drawPaymentPdfCell(canvas, "받는 분", left, 158f, 118f, 194f, tealSoft, muted, 8f, false, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, "${contract.customer} 귀하", 118f, 158f, right, 194f, android.graphics.Color.WHITE, ink, 12f, true)

    val amountFill = android.graphics.Paint().apply { color = tealSoft; style = android.graphics.Paint.Style.FILL }
    canvas.drawRoundRect(left, 212f, right, 284f, 12f, 12f, amountFill)
    canvas.drawText("영수금액", left + 18f, 232f, paymentPdfPaint(muted, 8f))
    canvas.drawText("일금 ${koreanReceiptAmount(paid)}정", left + 18f, 257f, paymentPdfPaint(tealDark, 13f, true))
    canvas.drawText(won(paid), right - 18f, 257f, paymentPdfPaint(tealDark, 20f, true, android.graphics.Paint.Align.RIGHT))
    canvas.drawText("상기 금액을 아래 거래내역과 같이 정히 영수하였습니다.", left + 18f, 274f, paymentPdfPaint(muted, 7.5f))

    canvas.drawText("거래 내역", left, 310f, paymentPdfPaint(ink, 12f, true))
    val columns = floatArrayOf(left, 102f, 220f, 270f, 306f, 390f, right)
    val headers = listOf("거래일", "품목명", "규격", "수량", "단가", "금액")
    headers.indices.forEach { index ->
        drawPaymentPdfCell(canvas, headers[index], columns[index], 322f, columns[index + 1], 349f, teal, android.graphics.Color.WHITE, 7.5f, true, android.graphics.Paint.Align.CENTER)
    }
    val values = listOf(LocalDate.now().toString(), contract.item.ifBlank { "공사·납품·서비스" }, "-", "1", won(paid), won(paid))
    values.indices.forEach { index ->
        val align = if (index >= 3) android.graphics.Paint.Align.RIGHT else if (index == 0 || index == 2) android.graphics.Paint.Align.CENTER else android.graphics.Paint.Align.LEFT
        drawPaymentPdfCell(canvas, values[index], columns[index], 349f, columns[index + 1], 380f, android.graphics.Color.WHITE, ink, 7.3f, index == 5, align)
    }
    for (row in 0 until 2) {
        val top = 380f + row * 30f
        for (index in 0 until columns.lastIndex) {
            drawPaymentPdfCell(canvas, "", columns[index], top, columns[index + 1], top + 30f)
        }
    }

    drawPaymentPdfCell(canvas, "결제방법", left, 458f, 110f, 488f, tealSoft, teal, 8f, false, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, "□ 현금   □ 계좌이체   □ 카드", 110f, 458f, 300f, 488f)
    drawPaymentPdfCell(canvas, "공급가액", 300f, 458f, 415f, 482f, android.graphics.Color.WHITE, muted, 8f)
    drawPaymentPdfCell(canvas, won(supply), 415f, 458f, right, 482f, android.graphics.Color.WHITE, ink, 8.5f, false, android.graphics.Paint.Align.RIGHT)
    drawPaymentPdfCell(canvas, "비고", left, 488f, 110f, 518f, tealSoft, teal, 8f, false, android.graphics.Paint.Align.CENTER)
    drawPaymentPdfCell(canvas, if (quote?.vatEnabled == false) "부가세 별도" else "부가세 포함", 110f, 488f, 300f, 518f)
    drawPaymentPdfCell(canvas, "부가가치세", 300f, 482f, 415f, 506f, android.graphics.Color.WHITE, muted, 8f)
    drawPaymentPdfCell(canvas, if (quote?.vatEnabled == false) "별도" else won(vat), 415f, 482f, right, 506f, android.graphics.Color.WHITE, ink, 8.5f, false, android.graphics.Paint.Align.RIGHT)
    drawPaymentPdfCell(canvas, "합계금액", 300f, 506f, 415f, 536f, tealSoft, ink, 9f, true)
    drawPaymentPdfCell(canvas, won(paid), 415f, 506f, right, 536f, tealSoft, teal, 11f, true, android.graphics.Paint.Align.RIGHT)

    canvas.drawText("공급자 정보", left, 564f, paymentPdfPaint(ink, 12f, true))
    val supplierRows = listOf(
        listOf("사업자등록번호", profile.registrationNo.ifBlank { "-" }, "상호", profile.businessName.ifBlank { "원비즈 사용자" }),
        listOf("대표자", profile.representative.ifBlank { "-" }, "연락처", profile.phone.ifBlank { "-" }),
        listOf("사업장 주소", profile.fullAddress.ifBlank { "-" }, "업태·종목", "공사·납품·서비스")
    )
    supplierRows.indices.forEach { index ->
        val top = 576f + index * 30f
        val row = supplierRows[index]
        drawPaymentPdfCell(canvas, row[0], left, top, 125f, top + 30f, light, muted, 7.5f, false, android.graphics.Paint.Align.CENTER)
        drawPaymentPdfCell(canvas, row[1], 125f, top, 300f, top + 30f)
        drawPaymentPdfCell(canvas, row[2], 300f, top, 370f, top + 30f, light, muted, 7.5f, false, android.graphics.Paint.Align.CENTER)
        drawPaymentPdfCell(canvas, row[3], 370f, top, right, top + 30f, android.graphics.Color.WHITE, ink, 8.5f, index == 0)
    }

    val confirmFill = android.graphics.Paint().apply { color = light; style = android.graphics.Paint.Style.FILL }
    canvas.drawRoundRect(left, 683f, right, 743f, 10f, 10f, confirmFill)
    canvas.drawText("위 금액을 수령하였음을 확인합니다.", left + 15f, 706f, paymentPdfPaint(muted, 8f))
    val issuerText = listOf(profile.businessName, profile.representative).filter { it.isNotBlank() }.joinToString("  ").ifBlank { "사업자 정보 확인 필요" }
    canvas.drawText(issuerText, right - 72f, 728f, paymentPdfPaint(ink, 9f, true, android.graphics.Paint.Align.RIGHT))
    drawCompanyElectronicSeal(canvas, right - 37f, 714f, profile, 22f)

    canvas.drawLine(left, 796f, right, 796f, android.graphics.Paint().apply { color = teal; strokeWidth = 1f })
    canvas.drawText("본 간이영수증은 거래 및 대금수령 확인용이며 세금계산서를 대신하지 않습니다.", left, 814f, paymentPdfPaint(muted, 7f))
    canvas.drawText("ONEBIZ · 견적부터 계약·서명·대금관리까지 하나로", right, 814f, paymentPdfPaint(teal, 7f, false, android.graphics.Paint.Align.RIGHT))
}

private fun sendPaymentDocumentAlimtalk(context: Context, quote: Quote, type: String, receivedAmount: Long = 0L,
    expectedUserId: String, expectedToken: String, onResult: (Boolean, String) -> Unit) {
    val kind = if (type == "간이영수증") "receipt" else "statement"
    val token = expectedToken
    val sendingUserId = expectedUserId
    if (token.isBlank()) {
        onResult(false, "원비즈 계정에 로그인해 주세요.")
        return
    }
    if (!Regex("^010[0-9]{8}$").matches(quote.phone.filter(Char::isDigit))) {
        onResult(false, "견적서에 등록된 고객번호를 확인해 주세요.")
        return
    }
    if (kind == "receipt") {
        val validation = validateReceiptAmountInput(receivedAmount.toString(), quote.total.toLong())
        if (validation.value == null) { onResult(false, validation.error); return }
    }
    val guard = runCatching { OnebizSendPreflight.capture(context, sendingUserId, token, quote = quote) }
        .getOrElse { onResult(false, it.message ?: ONEBIZ_SEND_SYNC_HELP); return }
    Thread {
        var result = "알림톡이 발송되지 않았습니다."
        var accepted = false
        try {
          guard.whenReady {
            val payload = JSONObject().apply {
                put("kind", kind)
                put("quoteId", quote.id)
                if (kind == "receipt") put("receivedAmount", receivedAmount)
            }
            val (ok, code, body) = guard.request(
                "POST", "/api/alimtalk/customer/document/preview", payload
            )
            if (!ok) result = "문서 확인 실패 · " + onebizErrorMessage(code, body)
            else {
                val preview = JSONObject(body)
                val expected = quote.phone.filter(Char::isDigit)
                val masked = expected.take(3) + "-****-" + expected.takeLast(4)
                if (masked != preview.optString("maskedTo")) {
                    result = "서버와 견적서 고객번호가 다릅니다. 동기화 후 다시 시도해 주세요."
                } else if (!preview.optBoolean("sendEnabled", false)) {
                    result = preview.optString("reason").ifBlank { "알림톡 발송이 비활성화되어 있습니다." }
                } else {
                    payload.put("confirm", true)
                    val (sent, sendCode, sendBody) = guard.request(
                        "POST", "/api/alimtalk/customer/document/send", payload
                    )
                    val outcome = onebizSendOutcome(sent, sendCode, sendBody)
                    accepted = outcome == OnebizSendOutcome.ACCEPTED
                    if (outcome != OnebizSendOutcome.FAILED) DocumentCenterRepository.invalidate(context, sendingUserId, token)
                    result = when (outcome) {
                        OnebizSendOutcome.ACCEPTED -> "${type} 알림톡이 SOLAPI에 접수됐습니다. 최종 수신 여부는 발송내역에서 확인해 주세요."
                        OnebizSendOutcome.UNKNOWN -> ONEBIZ_SEND_UNKNOWN_MESSAGE
                        OnebizSendOutcome.FAILED -> "알림톡 발송 실패 · " + onebizErrorMessage(sendCode, sendBody)
                    }
                }
            }
          }
        } catch (e: Exception) {
            result = e.message ?: "발송 준비를 완료하지 못했습니다. $ONEBIZ_SEND_SYNC_HELP"
        }
        Handler(Looper.getMainLooper()).post {
            if (guard.sessionIsCurrent()) onResult(accepted, result)
        }
    }.start()
}

/** Issue an existing ONEBIZ document design from the quote, without creating or mutating a contract. */
private fun shareQuotePaymentDocumentPdf(context: Context, quote: Quote, type: String, receivedAmount: Long = 0L): Boolean {
    if (type !in setOf("거래명세서", "간이영수증")) return false
    if (type == "간이영수증" && validateReceiptAmountInput(receivedAmount.toString(), quote.total.toLong()).value == null) {
        Toast.makeText(context, "실제로 받은 금액을 확인해 주세요.", Toast.LENGTH_LONG).show()
        return false
    }
    return try {
        val contractView = Contract(
            id = quote.id, quoteId = quote.id, customer = quote.customer,
            item = if (quote.items.size == 1) quote.items.first().name else "거래대금 (총 ${quote.items.size}개 품목)",
            amount = quote.total, signed = false, paidAmount = receivedAmount.toInt(),
            phone = quote.phone, address = listOf(quote.address, quote.customerAddressDetail).filter { it.isNotBlank() }.joinToString(" "),
            contractDate = quote.createdAt, siteAddress = quote.siteAddress, siteAddressDetail = quote.siteAddressDetail
        )
        val pdf = PdfDocument()
        try {
            val profile = loadBusinessProfile(context)
            val page = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
            if (type == "간이영수증") drawSimpleReceiptPdf(page.canvas, contractView, profile, quote)
            else drawTransactionStatementPdf(page.canvas, contractView, profile, quote)
            pdf.finishPage(page)
            if (type == "거래명세서" && quote.items.size > 4) {
                val remaining = quote.items.drop(4).chunked(14)
                remaining.forEachIndexed { index, items ->
                    val extra = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, index + 2).create())
                    drawQuoteStatementAppendix(extra.canvas, quote, index + 2, remaining.size + 1, items)
                    pdf.finishPage(extra)
                }
            }
            val dir = File(context.cacheDir, "share").apply { mkdirs() }
            val safeId = quote.id.replace(Regex("[^a-zA-Z0-9_-]"), "_").take(48)
            val file = File(dir, "${type}_${safeId}_${System.currentTimeMillis()}.pdf")
            FileOutputStream(file).use { pdf.writeTo(it) }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                setType("application/pdf")
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, "${quote.customer} ${type} · ${quote.id}")
                clipData = android.content.ClipData.newUri(context.contentResolver, type, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(intent, "${type} PDF 공유하기").apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
        } finally {
            pdf.close()
        }
        true
    } catch (e: Exception) {
        Toast.makeText(context, "${type} PDF 공유 실패: ${e.message ?: "오류"}", Toast.LENGTH_LONG).show()
        false
    }
}

private fun sharePaymentDocumentPdf(context: Context, contract: Contract, type: String): Boolean {
    if (type == "간이영수증" && contract.paidAmount <= 0) {
        Toast.makeText(context, "입금 등록 후 간이영수증을 발행할 수 있습니다.", Toast.LENGTH_SHORT).show()
        return false
    }
    return try {
        val pdf = PdfDocument()
        val page = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
        val profile = loadBusinessProfile(context)
        if (type == "간이영수증") drawSimpleReceiptPdf(page.canvas, contract, profile)
        else drawTransactionStatementPdf(page.canvas, contract, profile)
        pdf.finishPage(page)
        val dir = java.io.File(context.cacheDir, "share").apply { mkdirs() }
        val file = java.io.File(dir, "${type}_${contract.id}.pdf")
        java.io.FileOutputStream(file).use { pdf.writeTo(it) }
        pdf.close()
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            setType("application/pdf")
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, "$type 보내기"))
        true
    } catch (e: Exception) {
        Toast.makeText(context, "$type 생성 실패: ${e.message ?: "오류"}", Toast.LENGTH_LONG).show()
        false
    }
}

private fun sharePaymentDocumentPdfLegacy(context: Context, contract: Contract, type: String): Boolean {
    return try {
        val pdf = PdfDocument()
        val page = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
        val canvas = page.canvas
        val profile = loadBusinessProfile(context)

        if (type == "간이영수증") {
            val linePaint = android.graphics.Paint().apply {
                color = android.graphics.Color.rgb(55, 55, 55)
                style = android.graphics.Paint.Style.STROKE
                strokeWidth = 1.2f
                isAntiAlias = true
            }
            val titlePaint = android.graphics.Paint().apply {
                color = android.graphics.Color.BLACK
                textSize = 25f
                isFakeBoldText = true
                textAlign = android.graphics.Paint.Align.CENTER
                isAntiAlias = true
            }
            val headPaint = android.graphics.Paint().apply {
                color = android.graphics.Color.BLACK
                textSize = 11f
                isFakeBoldText = true
                isAntiAlias = true
            }
            val textPaint = android.graphics.Paint().apply {
                color = android.graphics.Color.DKGRAY
                textSize = 10.5f
                isAntiAlias = true
            }
            val amountPaint = android.graphics.Paint().apply {
                color = android.graphics.Color.BLACK
                textSize = 18f
                isFakeBoldText = true
                isAntiAlias = true
            }

            val left = 45f
            val right = 550f
            var top = 48f

            canvas.drawText("NO. ${contract.id}", left, top + 8f, textPaint)
            canvas.drawText("영 수 증", (left + right) / 2f, top + 18f, titlePaint)
            canvas.drawText("(공급받는자용)", right - 92f, top + 10f, headPaint)
            top += 42f

            fun box(l: Float, t: Float, r: Float, b: Float) {
                canvas.drawRect(l, t, r, b, linePaint)
            }
            fun vline(x: Float, t: Float, b: Float) { canvas.drawLine(x, t, x, b, linePaint) }
            fun hline(y: Float, l: Float = left, r: Float = right) { canvas.drawLine(l, y, r, y, linePaint) }
            fun cellLabel(text: String, x: Float, y: Float) { canvas.drawText(text, x + 5f, y + 17f, headPaint) }
            fun cellText(text: String, x: Float, y: Float, maxChars: Int = 34) {
                canvas.drawText(text.take(maxChars), x + 5f, y + 17f, textPaint)
            }

            // 공급자 정보
            val supplierTop = top
            val supplierBottom = supplierTop + 116f
            box(left, supplierTop, right, supplierBottom)
            val labelW = 88f
            val rowH = 29f
            for (i in 1..3) hline(supplierTop + rowH * i)
            vline(left + labelW, supplierTop, supplierBottom)
            cellLabel("공급자 등록번호", left, supplierTop)
            cellText(profile.registrationNo.ifBlank { "-" }, left + labelW, supplierTop)
            cellLabel("상호 / 성명", left, supplierTop + rowH)
            cellText(listOf(profile.businessName, profile.representative).filter { it.isNotBlank() }.joinToString(" / ").ifBlank { "-" }, left + labelW, supplierTop + rowH)
            cellLabel("사업장 주소", left, supplierTop + rowH * 2)
            cellText(listOf(profile.address, profile.addressDetail).filter { it.isNotBlank() }.joinToString(" ").ifBlank { "-" }, left + labelW, supplierTop + rowH * 2, 48)
            cellLabel("연락처", left, supplierTop + rowH * 3)
            cellText(profile.phone.ifBlank { "-" }, left + labelW, supplierTop + rowH * 3)
            top = supplierBottom + 14f

            // 작성일 / 공급대가총액 / 비고
            val summaryH = 42f
            box(left, top, right, top + summaryH)
            val c1 = left + 145f
            val c2 = left + 405f
            vline(c1, top, top + summaryH)
            vline(c2, top, top + summaryH)
            canvas.drawText("작성일자", left + 6f, top + 14f, headPaint)
            canvas.drawText("${LocalDate.now()}", left + 6f, top + 33f, textPaint)
            canvas.drawText("공급대가총액", c1 + 6f, top + 14f, headPaint)
            canvas.drawText(won(contract.paidAmount), c1 + 6f, top + 34f, amountPaint)
            canvas.drawText("비고", c2 + 6f, top + 14f, headPaint)
            canvas.drawText(if (contract.paidAmount >= contract.amount) "완납" else "부분입금", c2 + 6f, top + 33f, textPaint)
            top += summaryH

            // 공급 내역 테이블
            val tableTop = top + 14f
            val headerH = 30f
            val itemH = 34f
            val rows = 8
            val tableBottom = tableTop + headerH + itemH * rows
            box(left, tableTop, right, tableBottom)
            val xs = listOf(left, left + 58f, left + 274f, left + 324f, left + 404f, right)
            xs.drop(1).dropLast(1).forEach { x -> vline(x, tableTop, tableBottom) }
            hline(tableTop + headerH)
            for (i in 1 until rows) hline(tableTop + headerH + itemH * i)

            listOf("월/일", "품목", "수량", "단가", "금액").forEachIndexed { i, text ->
                canvas.drawText(text, xs[i] + 6f, tableTop + 20f, headPaint)
            }
            val itemY = tableTop + headerH
            val today = LocalDate.now()
            cellText("${today.monthValue}/${today.dayOfMonth}", xs[0], itemY, 8)
            cellText(contract.item.ifBlank { "거래대금" }, xs[1], itemY, 28)
            cellText("1", xs[2], itemY, 5)
            cellText(contract.paidAmount.toString(), xs[3], itemY, 14)
            cellText(contract.paidAmount.toString(), xs[4], itemY, 14)

            val footerTop = tableBottom + 18f
            canvas.drawText("위 금액을 영수하였음을 확인합니다.", left, footerTop + 18f, textPaint)
            canvas.drawText("공급자: ${profile.businessName.ifBlank { "원비즈 사용자" }}", left, footerTop + 48f, headPaint)
            canvas.drawText("대표자: ${profile.representative.ifBlank { "-" }}   (인)", left, footerTop + 68f, textPaint)
        } else {
            val paint = android.graphics.Paint().apply { color = android.graphics.Color.BLACK; textSize = 18f; isAntiAlias = true }
            val small = android.graphics.Paint().apply { color = android.graphics.Color.DKGRAY; textSize = 12f; isAntiAlias = true }
            var y = 70f
            fun line(text: String, gap: Float = 28f, bold: Boolean = false) {
                paint.isFakeBoldText = bold
                canvas.drawText(text, 50f, y, if (bold) paint else small)
                y += gap
            }
            canvas.drawText("${profile.businessName.ifBlank { "ONEBIZ" }} $type", 50f, y, paint); y += 45f
            line("계약번호: ${contract.id}")
            line("고객명: ${contract.customer}")
            line("연락처: ${contract.phone}")
            line("주소: ${contract.address}")
            line("품목/공사: ${contract.item}")
            y += 8f
            line("총 계약금액: ${won(contract.amount)}", 30f, true)
            line("입금액: ${won(contract.paidAmount)}")
            line("미수금: ${won((contract.amount - contract.paidAmount).coerceAtLeast(0))}", 30f, true)
            line("발행일: ${LocalDate.now()}")
            y += 20f
            line("본 문서는 계약 및 입금 현황을 기준으로 작성된 거래내역입니다.")
            y += 60f
            line(profile.businessName.ifBlank { "ONEBIZ" }, 28f, true)
        }

        pdf.finishPage(page)
        val dir = java.io.File(context.cacheDir, "share").apply { mkdirs() }
        val file = java.io.File(dir, "${type}_${contract.id}.pdf")
        java.io.FileOutputStream(file).use { pdf.writeTo(it) }
        pdf.close()
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            setType("application/pdf")
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, "$type 보내기"))
        true
    } catch (e: Exception) {
        Toast.makeText(context, "$type 생성 실패: ${e.message ?: "오류"}", Toast.LENGTH_LONG).show()
        false
    }
}

fun saveBusinessProfile(context: Context, profile: BusinessProfile) {
    val o = JSONObject().apply {
        put("businessName", profile.businessName); put("representative", profile.representative); put("registrationNo", profile.registrationNo)
        put("address", profile.address); put("addressDetail", profile.addressDetail); put("phone", profile.phone); put("email", profile.email); put("profileType", profile.profileType)
        put("bankName", profile.bankName); put("accountNumber", profile.accountNumber); put("accountHolder", profile.accountHolder)
        put("industry", profile.industry)
    }
    context.getSharedPreferences("hiwon_business_profile", Context.MODE_PRIVATE).edit().putString("profile", o.toString()).apply()
}

fun loadBusinessProfile(context: Context): BusinessProfile {
    val raw = context.getSharedPreferences("hiwon_business_profile", Context.MODE_PRIVATE).getString("profile", null) ?: return BusinessProfile()
    return runCatching {
        JSONObject(raw).let { o -> BusinessProfile(o.optString("businessName"), o.optString("representative"), o.optString("registrationNo"), o.optString("address"), o.optString("addressDetail"), o.optString("phone"), o.optString("email"), o.optString("profileType", "BUSINESS"), o.optString("bankName"), o.optString("accountNumber"), o.optString("accountHolder"), o.optString("industry")) }
    }.getOrDefault(BusinessProfile())
}


const val ONEBIZ_CLOUD_BASE_URL = "https://onebiz-pc-web.onrender.com"

private const val ONEBIZ_LINK_PREF = "onebiz_cloud_link"
internal fun onebizCloudPrefs(context: Context) = context.getSharedPreferences(ONEBIZ_LINK_PREF, Context.MODE_PRIVATE)
internal fun onebizCloudToken(context: Context): String = onebizCloudPrefs(context).getString("token", "").orEmpty()
internal fun onebizCloudUserId(context: Context): String = onebizCloudPrefs(context).getString("user_id", "").orEmpty()
private fun onebizPendingRequestId(context: Context): String = onebizCloudPrefs(context).getString("request_id", "").orEmpty()
private fun onebizPendingVerifier(context: Context): String = onebizCloudPrefs(context).getString("verifier", "").orEmpty()
private fun onebizPendingPhrase(context: Context): String = onebizCloudPrefs(context).getString("phrase", "").orEmpty()

data class OnebizSubscriptionState(
    val plan: String = "free",
    val status: String = "active",
    val expiresAt: Long = 0L,
    val adFree: Boolean = false,
    val features: Set<String> = emptySet(),
    val updatedAt: Long = 0L
)

internal fun saveOnebizSubscriptionState(context: Context, user: JSONObject?) {
    val sub = user?.optJSONObject("subscription") ?: return
    val featureObj = sub.optJSONObject("features") ?: JSONObject()
    val enabled = mutableListOf<String>()
    featureObj.keys().forEach { key -> if (featureObj.optBoolean(key, false)) enabled += key }
    onebizCloudPrefs(context).edit()
        .putString("subscription_plan", sub.optString("plan", "free"))
        .putString("subscription_status", sub.optString("status", "active"))
        .putLong("subscription_expires", sub.optLong("expiresAt", 0L))
        .putBoolean("ad_free", sub.optBoolean("adFree", false))
        .putString("entitlements", JSONArray(enabled).toString())
        .putLong("subscription_updated", sub.optLong("updatedAt", 0L))
        .apply()
}

fun onebizSubscriptionState(context: Context): OnebizSubscriptionState {
    val prefs = onebizCloudPrefs(context)
    val raw = prefs.getString("entitlements", "[]").orEmpty()
    val features = runCatching {
        val arr = JSONArray(raw)
        (0 until arr.length()).mapNotNull { arr.optString(it).takeIf(String::isNotBlank) }.toSet()
    }.getOrDefault(emptySet())
    return OnebizSubscriptionState(
        plan = prefs.getString("subscription_plan", "free").orEmpty().ifBlank { "free" },
        status = prefs.getString("subscription_status", "active").orEmpty().ifBlank { "active" },
        expiresAt = prefs.getLong("subscription_expires", 0L),
        adFree = prefs.getBoolean("ad_free", false),
        features = features,
        updatedAt = prefs.getLong("subscription_updated", 0L)
    )
}

fun onebizHasEntitlement(context: Context, feature: String): Boolean {
    val state = onebizSubscriptionState(context)
    return when (feature) {
        "core_documents", "customer_management", "dispatch", "employee_management", "automatic_sync" -> true
        "ad_free" -> state.adFree
        else -> state.features.contains(feature)
    }
}

private fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
private fun sha256Base64Url(value: String): String = base64Url(MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)))

internal fun onebizCloudRequest(method: String, path: String, payload: JSONObject? = null, token: String = ""): Triple<Boolean, Int, String> {
    return try {
        val url = URL(ONEBIZ_CLOUD_BASE_URL.trimEnd('/') + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 12000
            readTimeout = if (path.startsWith("/api/contract/sign-") || path.startsWith("/api/document-center/refresh")) 65000 else 12000
            setRequestProperty("X-Onebiz-Client", "android")
            if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
            if (payload != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            }
        }
        if (payload != null) conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        val body = runCatching {
            (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        }.getOrDefault("")
        conn.disconnect()
        Triple(code in 200..299, code, body)
    } catch (e: Exception) {
        Triple(false, 0, e.message ?: "관리센터 연결 오류")
    }
}

internal fun onebizErrorMessage(code: Int, body: String): String {
    if (code == 0) return body.ifBlank { "관리센터 연결 오류" }
    return runCatching { JSONObject(body).optString("error") }.getOrDefault("").ifBlank { "관리센터 서버 응답 $code" }
}

internal fun logoutOnebizCloud(context: Context, onResult: (Boolean, String) -> Unit) {
    val token = onebizCloudToken(context)
    val userId = onebizCloudUserId(context)
    Thread {
        try {
            // Preserve the account's data privately, then remove it from the active workspace.
            synchronized(OnebizSyncRuntime.lock) {
                if (onebizCloudToken(context) != token || onebizCloudUserId(context) != userId) return@Thread
                OnebizGuestWorkspace.markExistingMember(context)
                OnebizAccountStorage.activate(context, "")
                check(onebizCloudPrefs(context).edit().clear().commit())
            }
            val ok = token.isBlank() || onebizCloudRequest("POST", "/api/logout", token = token).first
            onResult(true, if (ok) "계정 자료를 보관하고 로그아웃했습니다." else "계정 자료를 보관하고 이 기기에서 로그아웃했습니다.")
        } catch (_: Exception) {
            onResult(false, "기기 자료를 안전하게 보관하지 못해 로그아웃을 중단했습니다. 저장 공간을 확인해 주세요.")
        }
    }.start()
}

fun startOnebizDevicePairing(
    context: Context,
    provider: String? = null,
    termsAccepted: Boolean = false,
    onResult: (Boolean, String) -> Unit
) {
    Thread {
        // 이전에 끝나지 않은 요청은 새 로그인 시작 시 폐기합니다.
        onebizCloudPrefs(context).edit()
            .remove("request_id").remove("verifier").remove("phrase").remove("verification_url")
            .apply()
        val verifier = base64Url(ByteArray(32).also { SecureRandom().nextBytes(it) })
        val challenge = sha256Base64Url(verifier)
        val payload = JSONObject().put("challenge", challenge)
        if (!provider.isNullOrBlank()) {
            payload.put("provider", provider)
            payload.put("terms", termsAccepted)
            payload.put("privacy", termsAccepted)
            payload.put("marketing", false)
        }
        val (ok, code, body) = onebizCloudRequest("POST", "/api/device/start", payload)
        if (!ok) { onResult(false, onebizErrorMessage(code, body)); return@Thread }
        val obj = runCatching { JSONObject(body) }.getOrNull()
        val requestId = obj?.optString("requestId").orEmpty()
        val phrase = obj?.optString("phrase").orEmpty()
        val authUrl = obj?.optString("authUrl").orEmpty()
        val verificationUrl = obj?.optString("verificationUrl").orEmpty()
        val loginUrl = if (!provider.isNullOrBlank()) authUrl else verificationUrl
        if (requestId.isBlank() || verifier.isBlank() || loginUrl.isBlank()) {
            onResult(false, "원비즈 로그인 요청 정보를 받지 못했습니다."); return@Thread
        }
        onebizCloudPrefs(context).edit()
            .putString("request_id", requestId)
            .putString("verifier", verifier)
            .putString("phrase", phrase)
            .putString("verification_url", loginUrl)
            .commit()
        Handler(Looper.getMainLooper()).post {
            runCatching {
                if (!provider.isNullOrBlank()) {
                    CustomTabsIntent.Builder()
                        .setShowTitle(false)
                        .build()
                        .launchUrl(context, Uri.parse(loginUrl))
                } else {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(loginUrl)).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    })
                }
            }.onSuccess {
                val name = when (provider) { "kakao" -> "카카오"; "naver" -> "네이버"; "google" -> "Google"; else -> "원비즈" }
                onResult(true, "$name 인증을 진행해 주세요. 완료되면 원비즈로 자동 복귀합니다.")
            }.onFailure {
                onResult(false, "로그인 화면을 열지 못했습니다. ${it.message ?: "인증 앱을 확인해 주세요."}")
            }
        }
    }.start()
}

private fun cancelOnebizPendingPairing(context: Context) {
    synchronized(OnebizSyncRuntime.lock) {
        onebizCloudPrefs(context).edit()
            .remove("request_id").remove("verifier").remove("phrase").remove("verification_url")
            .commit()
    }
}

fun pollOnebizDevicePairing(context: Context, onResult: (Boolean, String) -> Unit) {
    val requestId = onebizPendingRequestId(context)
    val verifier = onebizPendingVerifier(context)
    if (requestId.isBlank() || verifier.isBlank()) { onResult(false, "먼저 관리자센터 연결을 시작해 주세요."); return }
    Thread {
        val payload = JSONObject().put("requestId", requestId).put("verifier", verifier)
        val (ok, code, body) = onebizCloudRequest("POST", "/api/device/poll", payload)
        if (code == 202) { onResult(false, "소셜 인증 완료를 기다리는 중입니다."); return@Thread }
        if (!ok) {
            val message = onebizErrorMessage(code, body)
            val expired = code == 400 && (message.contains("만료") || message.contains("확인되지"))
            if (expired) {
                onebizCloudPrefs(context).edit()
                    .remove("request_id").remove("verifier").remove("phrase").remove("verification_url")
                    .apply()
                onResult(false, "로그인 요청이 만료되었습니다. 카카오·네이버·Google 로그인을 다시 눌러 주세요.")
                return@Thread
            }
            onResult(false, message); return@Thread
        }
        val obj = runCatching { JSONObject(body) }.getOrNull()
        val token = obj?.optString("token").orEmpty()
        val userId = obj?.optString("userId").orEmpty()
        if (token.isBlank() || userId.isBlank()) { onResult(false, "기기 승인 정보를 확인하지 못했습니다."); return@Thread }
        val saved = try {
            synchronized(OnebizSyncRuntime.lock) {
                if (onebizPendingRequestId(context) != requestId || onebizPendingVerifier(context) != verifier) return@Thread
                OnebizGuestWorkspace.markExistingMember(context)
                OnebizAccountStorage.activate(context, userId)
                OnebizSyncRuntime.hydratedToken = ""
                onebizCloudPrefs(context).edit()
                    .putString("token", token)
                    .putString("user_id", userId)
                    .remove("request_id").remove("verifier").remove("phrase").remove("verification_url")
                    .commit()
            }
        } catch (_: Exception) {
            onResult(false, "이전 계정 자료를 보관하지 못했습니다. 저장 공간을 확인한 뒤 다시 로그인해 주세요.")
            return@Thread
        }
        if (!saved || onebizCloudToken(context).isBlank()) {
            onResult(false, "연결 승인은 완료됐지만 인증정보 저장에 실패했습니다. 다시 승인 확인을 눌러 주세요.")
            return@Thread
        }
        onResult(true, "원비즈 계정 연결 완료 · 자동 동기화를 시작합니다")
    }.start()
}

internal fun onebizProfileJson(profile: BusinessProfile) = JSONObject().apply {
    put("businessName", profile.businessName)
    put("representative", profile.representative)
    put("registrationNo", profile.registrationNo)
    put("address", profile.address)
    put("addressDetail", profile.addressDetail)
    put("phone", profile.phone)
    put("email", profile.email)
    put("profileType", profile.profileType)
    put("bankName", profile.bankName)
    put("accountNumber", profile.accountNumber)
    put("accountHolder", profile.accountHolder)
    put("industry", profile.industry)
}

fun sendOnebizAlimtalk(
    context: Context,
    type: String,
    recipientName: String,
    recipient: String,
    title: String,
    message: String,
    link: String = "",
    templateCode: String = type,
    contractId: String = "",
    quoteId: String = "",
    expectedQuote: Quote? = null,
    expectedContract: Contract? = null,
    expectedUserId: String,
    expectedToken: String,
    onResult: (Boolean, String) -> Unit
) {
    // SOLAPI keys must remain on the server. The Android app authenticates as the signed-in member.
    val token = expectedToken
    val sendingUserId = expectedUserId
    if (token.isBlank()) {
        onResult(false, "원비즈 로그인이 필요합니다. 내 정보에서 카카오·네이버·Google로 로그인해 주세요.")
        return
    }
    val digits = recipient.filter(Char::isDigit)
    if (!Regex("^010[0-9]{8}$").matches(digits)) {
        onResult(false, "견적서 또는 계약서에 등록된 고객 휴대폰 번호를 확인해 주세요.")
        return
    }
    val kind = when {
        templateCode == "ONEBIZ_QUOTE_NOTICE" && quoteId.isNotBlank() -> "quote"
        type == "계약서서명요청" && contractId.isNotBlank() -> "contractSign"
        templateCode == "ONEBIZ_PAYMENT_1" && contractId.isNotBlank() -> "receivable"
        else -> ""
    }
    if (kind.isBlank()) {
        onResult(false, "선택한 알림톡 유형은 승인 문구와 원비즈 서버 연결이 완료되지 않아 발송할 수 없습니다. 임의 메시지는 카카오 알림톡으로 전송하지 않습니다.")
        return
    }
    if ((kind == "quote" && (expectedQuote == null || expectedQuote.id != quoteId)) ||
        (kind != "quote" && (expectedContract == null || expectedContract.id != contractId))) {
        onResult(false, "발송할 문서를 다시 열어 확인해 주세요.")
        return
    }
    val guard = runCatching { OnebizSendPreflight.capture(context, sendingUserId, token, expectedQuote, expectedContract) }
        .getOrElse { onResult(false, it.message ?: ONEBIZ_SEND_SYNC_HELP); return }
    Thread {
      var detail = "알림톡을 발송하지 않았습니다."
      var accepted = false
      var attempted = false
      var outcome = OnebizSendOutcome.FAILED
      try {
       guard.whenReady {
        val body = JSONObject().apply {
            put("kind", kind)
            if (kind == "quote") put("quoteId", quoteId) else put("contractId", contractId)
        }
        val previewPath = if (kind == "quote")
            "/api/alimtalk/customer/quote/preview" else "/api/alimtalk/customer/preview"
        val (ready, previewCode, previewBody) = guard.request("POST", previewPath, body)
        if (!ready) {
            detail = onebizErrorMessage(previewCode, previewBody)
        } else {
            val preview = runCatching { JSONObject(previewBody) }.getOrNull()
            if (preview == null) {
                detail = "원비즈 서버에서 알림톡 확인 결과를 받지 못했습니다. 발송되지 않았습니다."
            } else if (!preview.optBoolean("sendEnabled", false)) {
                detail = preview.optString("reason").ifBlank {
                    if (preview.optString("gateway") == "blocked") {
                        "SOLAPI API 접근이 제한된 상태입니다. 계정 인증/권한 확인 전까지 발송되지 않습니다."
                    } else {
                        "SOLAPI 승인 템플릿 또는 발송 서비스가 아직 연결되지 않았습니다. 발송되지 않았습니다."
                    }
                }
            } else {
                body.put("confirm", true)
                val sendPath = if (kind == "quote")
                    "/api/alimtalk/customer/quote/send" else "/api/alimtalk/customer/send"
                val (ok, code, responseBody) = guard.request("POST", sendPath, body)
                attempted = true
                outcome = onebizSendOutcome(ok, code, responseBody)
                accepted = outcome == OnebizSendOutcome.ACCEPTED
                if (outcome != OnebizSendOutcome.FAILED) DocumentCenterRepository.invalidate(context, sendingUserId, token)
                detail = when (outcome) {
                    OnebizSendOutcome.ACCEPTED -> "SOLAPI에 알림톡이 접수되었습니다. 실제 카카오톡 수신 완료 여부는 발송내역에서 별도 확인해야 합니다."
                    OnebizSendOutcome.UNKNOWN -> ONEBIZ_SEND_UNKNOWN_MESSAGE
                    OnebizSendOutcome.FAILED -> "알림톡 발송 실패 · " + onebizErrorMessage(code, responseBody)
                }
            }
        }
       }
      } catch (error: Exception) {
        detail = error.message ?: "발송 준비를 완료하지 못했습니다. $ONEBIZ_SEND_SYNC_HELP"
      }
        Handler(Looper.getMainLooper()).post {
            synchronized(OnebizSyncRuntime.lock) {
            if (!onebizSessionMatches(context, token, sendingUserId)) return@post
            // '접수'는 고객 기기의 '수신 완료'가 아니므로 발송완료로 처리하지 않습니다.
            if (attempted) recordAlimtalkHistory(
                context = context, contractId = contractId, templateCode = templateCode,
                type = type, recipientName = recipientName, recipient = digits,
                title = title, message = message,
                success = accepted, result = detail, status = outcome.code
            )
            onResult(accepted, detail)
            }
        }
    }.start()
}


data class DebtAlimtalkTemplate(
    val code: String,
    val label: String,
    val title: String,
    val message: String,
    val allowed: Boolean = true,
    val blockedReason: String = ""
)

private fun buildDebtAlimtalkTemplates(contract: Contract, business: BusinessProfile): List<DebtAlimtalkTemplate> {
    val remain = (contract.amount - contract.paidAmount).coerceAtLeast(0)
    val due = contract.demandDueDate.ifBlank { LocalDate.now().plusDays(7).toString() }
    val sender = business.businessName.ifBlank { business.representative.ifBlank { "ONEBIZ 이용 사업자" } }
    val contact = business.phone.ifBlank { "담당자 연락처" }
    val account = listOf(business.bankName, business.accountNumber, business.accountHolder)
        .filter { it.isNotBlank() }.joinToString(" ")
    val accountLine = if (account.isNotBlank()) "\n입금계좌: $account" else ""
    val commonTail = "\n이미 입금하신 경우 본 안내와 엇갈릴 수 있습니다. 금액 또는 거래내용에 이의가 있는 경우 $contact 로 문의해 주세요."

    return listOf(
        DebtAlimtalkTemplate(
            code = "ONEBIZ_PAYMENT_1",
            label = "1차 대금안내",
            title = "ONEBIZ 대금 안내",
            message = "${contract.customer} 고객님, 계약번호 ${contract.id} 관련 미지급 대금 ${won(remain)}원이 확인되어 안내드립니다.\n총 계약금액: ${won(contract.amount)}\n입금 확인액: ${won(contract.paidAmount)}\n지급 요청기한: $due$accountLine$commonTail\n- $sender"
        ),
        DebtAlimtalkTemplate(
            code = "ONEBIZ_PAYMENT_2",
            label = "2차 미수금 안내",
            title = "ONEBIZ 미수금 안내",
            message = "${contract.customer} 고객님, 계약번호 ${contract.id} 관련 지급 안내 후 현재 미수금 ${won(remain)}원이 확인됩니다.\n최종 지급 요청기한: $due$accountLine\n기한까지 지급 또는 지급일정 협의를 부탁드립니다. 지급 또는 협의가 이루어지지 않을 경우 내용증명 발송 등 채권 회수 절차를 검토할 수 있습니다.$commonTail\n- $sender",
            allowed = false,
            blockedReason = "승인 템플릿 연결 준비 중입니다. 현재 발송할 수 없습니다."
        ),
        DebtAlimtalkTemplate(
            code = "ONEBIZ_CERTIFIED_PRE",
            label = "내용증명 발송 예정",
            title = "ONEBIZ 내용증명 발송 예정 안내",
            message = "${contract.customer} 고객님, 계약번호 ${contract.id} 관련 미수금 ${won(remain)}원에 대하여 지급 안내 후 현재까지 지급 확인이 되지 않아 안내드립니다.\n최종 지급 요청기한: $due$accountLine\n해당 기한까지 지급 또는 협의가 이루어지지 않을 경우 미지급 대금 청구를 위한 내용증명 발송 및 지급명령 등 민사절차를 검토할 수 있습니다.$commonTail\n- $sender",
            allowed = false,
            blockedReason = "승인 템플릿 연결 준비 중입니다. 현재 발송할 수 없습니다."
        ),
        DebtAlimtalkTemplate(
            code = "ONEBIZ_CERTIFIED_SENT",
            label = "내용증명 발송 완료",
            title = "ONEBIZ 내용증명 발송 안내",
            message = "${contract.customer} 고객님, 계약번호 ${contract.id} 관련 미지급 대금 ${won(remain)}원에 대한 내용증명이 ${contract.certifiedMailAt.ifBlank { "발송일" }} 발송된 것으로 기록되어 안내드립니다.\n내용증명에 기재된 지급기한: $due$accountLine\n기한 경과 후에도 미지급 상태가 지속될 경우 지급명령 또는 민사소송 등 법적 절차를 검토할 수 있습니다.$commonTail\n- $sender",
            allowed = false,
            blockedReason = "승인 템플릿 연결 준비 중입니다. 현재 발송할 수 없습니다."
        )
    )
}

private fun recordAlimtalkHistory(
    context: Context,
    contractId: String,
    templateCode: String,
    type: String,
    recipientName: String,
    recipient: String,
    title: String,
    message: String,
    success: Boolean,
    result: String,
    status: String
) {
    runCatching {
        val prefs = context.getSharedPreferences("onebiz_alimtalk_history", Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString("history", "[]") ?: "[]")
        val item = JSONObject().apply {
            put("sentAt", java.time.LocalDateTime.now().toString())
            put("contractId", contractId)
            put("templateCode", templateCode)
            put("type", type)
            put("recipientName", recipientName)
            put("recipient", recipient)
            put("title", title)
            put("message", message)
            put("success", success)
            put("result", result)
            put("status", status)
        }
        val next = JSONArray().apply {
            put(item)
            (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
                .sortedByDescending { it.optString("sentAt") }.take(99).forEach { put(it) }
        }
        prefs.edit().putString("history", next.toString()).apply()
    }
}


data class AlimtalkHistoryItem(
    val sentAt: String,
    val contractId: String,
    val templateCode: String,
    val type: String,
    val recipientName: String,
    val recipient: String,
    val title: String,
    val success: Boolean,
    val result: String,
    val status: String
)

private fun loadAlimtalkHistory(context: Context): List<AlimtalkHistoryItem> = runCatching {
    val raw = context.getSharedPreferences("onebiz_alimtalk_history", Context.MODE_PRIVATE)
        .getString("history", "[]") ?: "[]"
    val arr = JSONArray(raw)
    (0 until arr.length()).mapNotNull { i ->
        arr.optJSONObject(i)?.let { o ->
            AlimtalkHistoryItem(
                sentAt = o.optString("sentAt"),
                contractId = o.optString("contractId"),
                templateCode = o.optString("templateCode"),
                type = o.optString("type"),
                recipientName = o.optString("recipientName"),
                recipient = o.optString("recipient"),
                title = o.optString("title"),
                success = o.optBoolean("success"),
                result = o.optString("result"),
                status = o.optString("status", if (o.optBoolean("success")) "accepted" else "failed")
            )
        }
    }.sortedByDescending { it.sentAt }
}.getOrDefault(emptyList())

@Composable
private fun AlimtalkHistoryDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val history = remember { loadAlimtalkHistory(context) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("알림톡 발송기록", fontWeight = FontWeight.Black) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (history.isEmpty()) {
                    Text("저장된 발송기록이 없습니다.", color = Muted)
                } else {
                    history.take(50).forEach { h ->
                        Surface(shape = RoundedCornerShape(12.dp), color = if (h.success) GreenSoft else OrangeSoft) {
                            Column(Modifier.fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text("${if (h.success) "발송 접수" else if (h.status == "unknown") "결과 미확인" else "실패"} · ${h.type}", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                Text("${h.sentAt.replace('T', ' ').take(19)} · 계약 ${h.contractId.ifBlank { "-" }}", color = Muted, fontSize = 10.sp)
                                Text("${h.recipientName} · ${phoneMask(h.recipient)}", fontSize = 11.sp)
                                Text("템플릿 ${h.templateCode}", color = Muted, fontSize = 10.sp)
                                if (h.result.isNotBlank()) Text(h.result, color = Muted, fontSize = 10.sp)
                            }
                        }
                    }
                }
                Text("※ 이 기록은 ONEBIZ 앱 내부 발송요청 기록입니다. 실제 카카오/알리고 발송·수신 증빙은 발송사 결과와 함께 확인하세요.", color = Muted, fontSize = 10.sp)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("확인") } }
    )
}

private fun phoneMask(value: String): String {
    val d = value.filter(Char::isDigit)
    return when {
        d.length >= 10 -> d.take(3) + "-****-" + d.takeLast(4)
        else -> value
    }
}

private fun updateDebtStageAfterAlimtalk(contract: Contract, templateCode: String): Contract {
    val today = LocalDate.now().toString()
    return when (templateCode) {
        "ONEBIZ_PAYMENT_1" -> contract.copy(
            debtStatus = "1차 독촉",
            firstDemandAt = contract.firstDemandAt.ifBlank { today },
            demandDueDate = contract.demandDueDate.ifBlank { LocalDate.now().plusDays(7).toString() }
        )
        "ONEBIZ_PAYMENT_2" -> contract.copy(
            debtStatus = "2차 독촉",
            firstDemandAt = contract.firstDemandAt.ifBlank { today },
            demandDueDate = contract.demandDueDate.ifBlank { LocalDate.now().plusDays(7).toString() }
        )
        "ONEBIZ_CERTIFIED_PRE" -> contract.copy(
            debtStatus = "내용증명 준비",
            demandDueDate = contract.demandDueDate.ifBlank { LocalDate.now().plusDays(7).toString() }
        )
        else -> contract
    }
}

@Composable
private fun DebtAlimtalkDialog(
    contract: Contract,
    businessProfile: BusinessProfile,
    onDismiss: () -> Unit,
    onDebtUpdate: (Contract) -> Unit
) {
    val context = LocalContext.current
    val documentOwnerId = remember { onebizCloudUserId(context) }
    val documentOwnerToken = remember { onebizCloudToken(context) }
    val templates = remember(contract, businessProfile) { buildDebtAlimtalkTemplates(contract, businessProfile) }
    var selectedCode by remember(contract.id, contract.debtStatus, contract.certifiedMailAt) {
        mutableStateOf(
            when {
                contract.certifiedMailAt.isNotBlank() -> "ONEBIZ_CERTIFIED_SENT"
                contract.debtStatus == "내용증명 준비" -> "ONEBIZ_CERTIFIED_PRE"
                contract.debtStatus == "2차 독촉" -> "ONEBIZ_PAYMENT_2"
                else -> "ONEBIZ_PAYMENT_1"
            }
        )
    }
    val selected = templates.firstOrNull { it.code == selectedCode } ?: templates.first()
    var phone by remember(contract.id) { mutableStateOf(contract.phone.filter(Char::isDigit).take(11)) }
    var busy by remember { mutableStateOf(false) }
    var resultText by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("대금·내용증명 알림톡", fontWeight = FontWeight.Black) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("계약번호 ${contract.id} · 미수금 ${won((contract.amount - contract.paidAmount).coerceAtLeast(0))}", color = Muted, fontSize = 12.sp)
                Text("안내 단계", fontWeight = FontWeight.Bold)
                templates.forEach { t ->
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        FilterChip(
                            selected = selectedCode == t.code,
                            onClick = { if (t.allowed) { selectedCode = t.code; resultText = "" } },
                            enabled = t.allowed,
                            label = { Text(t.label) },
                            modifier = Modifier.fillMaxWidth()
                        )
                        if (!t.allowed && t.blockedReason.isNotBlank()) {
                            Text(t.blockedReason, color = Muted, fontSize = 10.sp, modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it.filter(Char::isDigit).take(11) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("수신번호") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true
                )
                OutlinedTextField(
                    value = selected.title,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("템플릿 제목") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                OutlinedTextField(
                    value = selected.message,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("승인용 문구 미리보기") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 8
                )
                Surface(shape = RoundedCornerShape(12.dp), color = PurpleSoft) {
                    Text(
                        "알림톡은 지급 안내 기록을 남기는 수단이며, 내용증명 자체나 법원 절차를 대신하지 않습니다. 실제 발송 여부와 지급내역을 확인한 뒤 단계에 맞는 문구를 선택하세요.",
                        Modifier.padding(12.dp),
                        color = Muted,
                        fontSize = 11.sp
                    )
                }
                if (resultText.isNotBlank()) Text(resultText, color = if (resultText.contains("오류") || resultText.contains("필요")) MaterialTheme.colorScheme.error else Purple, fontSize = 12.sp)
                Text("※ 알리고에서 위 템플릿 코드별 문구 승인이 완료된 뒤 실제 알림톡 전송을 활성화하세요.", color = Muted, fontSize = 11.sp)
            }
        },
        confirmButton = {
            Button(
                enabled = !busy && selected.allowed && phone.length >= 10,
                onClick = {
                    busy = true
                    resultText = ""
                    sendOnebizAlimtalk(
                        context = context,
                        type = selected.label,
                        recipientName = contract.customer,
                        recipient = phone,
                        title = selected.title,
                        message = selected.message,
                        templateCode = selected.code,
                        contractId = contract.id,
                        expectedContract = contract,
                        expectedUserId = documentOwnerId,
                        expectedToken = documentOwnerToken
                    ) { ok, msg ->
                        busy = false
                        resultText = msg
                        if (ok) {
                            onDebtUpdate(updateDebtStageAfterAlimtalk(contract, selected.code))
                            Toast.makeText(context, "${selected.label} 발송 기록을 저장했습니다.", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text("선택 문구로 발송 요청")
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("닫기") } }
    )
}

@Composable
fun OnebizAlimtalkDialog(
    type: String,
    recipientName: String,
    initialPhone: String,
    initialTitle: String,
    initialMessage: String,
    onDismiss: () -> Unit,
    templateCode: String = type,
    contractId: String = "",
    quoteId: String = "",
    expectedQuote: Quote? = null,
    expectedContract: Contract? = null,
    messageEditable: Boolean = true,
    onDelivered: () -> Unit = {},
    onSharePdf: (() -> Unit)? = null
) {
    val context = LocalContext.current
    val documentOwnerId = remember { onebizCloudUserId(context) }
    val documentOwnerToken = remember { onebizCloudToken(context) }
    var phone by remember { mutableStateOf(initialPhone.filter(Char::isDigit).take(11)) }
    var title by remember { mutableStateOf(initialTitle) }
    var message by remember { mutableStateOf(initialMessage) }
    var busy by remember { mutableStateOf(false) }
    var resultText by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("카카오 알림톡", fontWeight = FontWeight.Black) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(shape = RoundedCornerShape(12.dp), color = Color(0xFFFFF4C7)) {
                    Text(if (quoteId.isNotBlank()) "견적 알림톡 · 승인/연결 상태 확인" else "알림톡 발송 준비 · ${type}", Modifier.padding(12.dp), fontWeight = FontWeight.Bold)
                }
                OutlinedTextField(
                    value = phone,
                    onValueChange = {},
                    readOnly = true,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("수신번호 (문서에 등록된 번호)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true
                )
                OutlinedTextField(title, {}, label = { Text("제목 · 미리보기") }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    readOnly = true)
                OutlinedTextField(message, {}, label = { Text("알림 내용 · 미리보기") }, modifier = Modifier.fillMaxWidth(), minLines = 5,
                    readOnly = true)
                if (resultText.isNotBlank()) {
                    Text(resultText, color = if (listOf("필요", "실패", "검수", "불가", "중단", "발송되지").any { resultText.contains(it) }) MaterialTheme.colorScheme.error else Purple, fontSize = 12.sp)
                }
                Text(
                    "※ 이 내용은 앱 미리보기입니다. 실제 발송은 원비즈 회원 계정으로 서버에서 승인 템플릿을 검증한 후 진행됩니다. 수신 확인 전에는 발송완료로 표시되지 않습니다.",
                    color = Muted,
                    fontSize = 11.sp
                )
                if (!messageEditable) Text("견적서 PDF는 이 알림톡에 첨부되지 않습니다. PDF는 견적 목록의 카카오톡 공유 버튼을 이용하세요.",
                    color = Muted, fontSize = 11.sp)
            }
        },
        confirmButton = {
            Button(
                enabled = !busy && phone.length >= 10 && title.isNotBlank() && message.isNotBlank(),
                onClick = {
                    busy = true
                    resultText = ""
                    sendOnebizAlimtalk(context, type, recipientName, phone, title, message, templateCode = templateCode, contractId = contractId, quoteId = quoteId,
                        expectedQuote = expectedQuote, expectedContract = expectedContract,
                        expectedUserId = documentOwnerId, expectedToken = documentOwnerToken) { ok, msg ->
                        busy = false
                        resultText = msg
                        if (ok) {
                            // SOLAPI accepted the request; customer delivery is checked separately.
                            onDelivered()
                            Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                        }
                    }
                }
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text("알림톡 발송 요청")
            }
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (onSharePdf != null) {
                    TextButton(enabled = !busy, onClick = onSharePdf) { Text("카카오톡 PDF 공유") }
                }
                TextButton(enabled = !busy, onClick = onDismiss) { Text("닫기") }
            }
        }
    )
}

private fun onebizSyncPayload(context: Context, profile: BusinessProfile, quotes: List<Quote>, contracts: List<Contract>): JSONObject {
    val today = LocalDate.now().toString()
    val receivables = contracts.filter { it.signed && (it.amount - it.paidAmount).coerceAtLeast(0) > 0 }
    return JSONObject().apply {
        put("memberId", onebizCloudUserId(context))
        put("profile", JSONObject().apply {
            put("businessName", profile.businessName)
            put("representative", profile.representative)
            put("registrationNo", profile.registrationNo)
            put("address", profile.fullAddress)
            put("phone", profile.phone)
            put("email", profile.email)
            put("profileType", profile.profileType)
            put("industry", profile.industry)
        })
        put("appVersion", BuildConfig.VERSION_NAME)
        put("metrics", JSONObject().apply {
            put("quotesTotal", quotes.size)
            put("contractsTotal", contracts.size)
            put("signedContracts", contracts.count { it.signed })
            put("todayQuotes", quotes.count { it.createdAt == today })
            put("todayContracts", contracts.count { it.contractDate == today })
            put("receivablesCount", receivables.size)
            put("receivablesAmount", receivables.sumOf { (it.amount - it.paidAmount).coerceAtLeast(0) })
        })
    }
}

fun submitOnebizDispatch(
    context: Context,
    equipment: String,
    address: String,
    useDate: String,
    arrivalTime: String,
    floor: String,
    cargo: String,
    durationMinutes: Int,
    phone: String,
    estimatedAmount: Int,
    requiresControlRoom: Boolean,
    controlRoomConfirmed: Boolean,
    onResult: (Boolean, String) -> Unit
) {
    val token = onebizCloudToken(context)
    if (token.isBlank()) {
        onResult(false, "내 정보에서 관리자센터 연결을 먼저 완료해 주세요.")
        return
    }
    val payload = JSONObject().apply {
        put("equipment", equipment)
        put("address", address.trim())
        put("date", useDate)
        put("arrivalTime", arrivalTime)
        put("floor", floor.trim())
        put("goods", cargo.trim())
        put("minutes", durationMinutes)
        put("phone", phone)
        put("estimatedAmount", estimatedAmount)
        put("requiresControlRoom", requiresControlRoom)
        put("controlRoomConfirmed", controlRoomConfirmed)
    }
    Thread {
        val (ok, code, body) = onebizCloudRequest("POST", "/api/dispatch", payload, token)
        Handler(Looper.getMainLooper()).post {
            onResult(
                ok,
                if (ok && requiresControlRoom) "상황실 확인 대상 배차로 접수되었습니다. 담당자가 확인 후 연락드립니다."
                else if (ok) "배차 신청이 접수되었습니다. 관리자 확인 후 연락드립니다."
                else onebizErrorMessage(code, body)
            )
        }
    }.start()
}

fun fullCustomerAddress(customer: Customer): String = listOf(customer.address.trim(), customer.addressDetail.trim()).filter { it.isNotBlank() }.joinToString(" ")
fun fullSiteAddress(q: Quote): String = listOf(q.siteAddress.trim(), q.siteAddressDetail.trim()).filter { it.isNotBlank() }.joinToString(" ")
fun fullSiteAddress(c: Contract): String = listOf(c.siteAddress.trim(), c.siteAddressDetail.trim()).filter { it.isNotBlank() }.joinToString(" ")

@Composable
fun OnebizSocialLoginScreen(
    status: String,
    onStart: (String) -> Unit
) {
    val context = LocalContext.current
    var accepted by remember { mutableStateOf(false) }
    val navy = Color(0xFF0B2F75)
    val blue = Color(0xFF1565E8)

    Box(
        Modifier.fillMaxSize().background(Color(0xFFF7FAFF))
    ) {
        // 부드러운 원비즈 배경 장식
        Box(Modifier.size(180.dp).offset((-70).dp, 70.dp).clip(CircleShape).background(Color(0xFFE8F1FF)))
        Box(Modifier.size(140.dp).align(Alignment.TopEnd).offset(50.dp, 150.dp).clip(CircleShape).background(Color(0xFFF0ECFF)))

        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(12.dp))
            Text("ONEBIZ", color = navy, fontSize = 38.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp)
            Text("원비즈", color = navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("견적부터 계약·대금관리까지 하나로!", color = navy, fontSize = 15.sp, fontWeight = FontWeight.Bold)

            Image(
                painter = painterResource(R.drawable.onebiz_character),
                contentDescription = "원비즈 캐릭터",
                modifier = Modifier.height(190.dp).fillMaxWidth(),
                contentScale = ContentScale.Fit
            )
            Text("당신의 든든한 파트너, 원비즈!", color = blue, fontSize = 18.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(14.dp))

            Button(
                onClick = { onStart("kakao") },
                enabled = accepted,
                modifier = Modifier.fillMaxWidth().height(54.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFEE500), contentColor = Color(0xFF191919), disabledContainerColor = Color(0xFFFFF4A8), disabledContentColor = Color(0xFF888169))
            ) {
                Text("●", fontSize = 18.sp)
                Spacer(Modifier.width(10.dp))
                Text("카카오로 시작하기", fontWeight = FontWeight.Black, fontSize = 16.sp)
            }
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = { onStart("naver") },
                enabled = accepted,
                modifier = Modifier.fillMaxWidth().height(54.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF03C75A), contentColor = Color.White, disabledContainerColor = Color(0xFFB9ECCC), disabledContentColor = Color.White)
            ) {
                Text("N", fontSize = 22.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.width(10.dp))
                Text("네이버로 시작하기", fontWeight = FontWeight.Black, fontSize = 16.sp)
            }
            Spacer(Modifier.height(10.dp))
            OutlinedButton(
                onClick = { onStart("google") },
                enabled = accepted,
                modifier = Modifier.fillMaxWidth().height(54.dp),
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, Color(0xFFB9C5D6)),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF202124))
            ) {
                Text("G", color = Color(0xFF4285F4), fontSize = 21.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.width(10.dp))
                Text("Google로 시작하기", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }


            Spacer(Modifier.height(12.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = Color.White),
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, Border),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = accepted, onCheckedChange = { accepted = it })
                        Text("[필수] 이용약관 및 개인정보처리방침에 동의합니다.", fontSize = 11.sp, color = Text, modifier = Modifier.weight(1f))
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$ONEBIZ_CLOUD_BASE_URL/legal/terms"))) }) { Text("이용약관", fontSize = 11.sp) }
                        TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$ONEBIZ_CLOUD_BASE_URL/legal/privacy"))) }) { Text("개인정보처리방침", fontSize = 11.sp) }
                    }
                }
            }

            if (status.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Text(status, color = Color(0xFF56709B), fontSize = 12.sp, textAlign = TextAlign.Center)
            }
            Spacer(Modifier.height(8.dp))
            Text("처음 한 번만 로그인하면 이후에는 원비즈 계정으로 자동 연결되고 PC 통합관리센터와 동기화됩니다.", color = Muted, fontSize = 11.sp, textAlign = TextAlign.Center)
            Text("ONEBIZ | 원비즈 ${BuildConfig.VERSION_NAME}", color = Color(0xFFA0A8B5), fontSize = 10.sp, modifier = Modifier.padding(top = 14.dp))
        }
    }
}

@Composable
fun OnebizLoginProgressScreen(status: String, onCancel: () -> Unit) {
    val navy = Color(0xFF0B2F75)
    Box(
        Modifier.fillMaxSize().background(Color(0xFFFAFCFF)).padding(28.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = Color(0xFF1D5CFF),
                modifier = Modifier.size(86.dp)
            ) {
                Box(contentAlignment = Alignment.Center) { Text("1B", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Black) }
            }
            Text("ONEBIZ", color = navy, fontSize = 30.sp, fontWeight = FontWeight.Black)
            CircularProgressIndicator(color = Color(0xFF2467F2), strokeWidth = 5.dp, modifier = Modifier.size(56.dp))
            Text("로그인 중입니다.", color = Color(0xFF151B26), fontSize = 22.sp, fontWeight = FontWeight.Black)
            Text("인증이 완료되면 자동으로 원비즈로 돌아옵니다.", color = Muted, fontSize = 13.sp, textAlign = TextAlign.Center)
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFF0F5FF)), shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF2467F2)); Spacer(Modifier.width(8.dp)); Text("계정 정보 확인 중") }
                    Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF2467F2)); Spacer(Modifier.width(8.dp)); Text("회원 데이터 연결 준비") }
                    Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF2467F2)); Spacer(Modifier.width(8.dp)); Text("앱으로 자동 복귀") }
                }
            }
            if (status.isNotBlank()) Text(status, color = Color(0xFF56709B), fontSize = 12.sp, textAlign = TextAlign.Center)
            TextButton(onClick = onCancel) { Text("로그인 다시 선택하기") }
        }
    }
}

@Composable
fun QuoteEditorScreen(
    customers: List<Customer>,
    nextId: String,
    initialQuote: Quote? = null,
    isCopyMode: Boolean = false,
    externalConflict: Boolean = false,
    onClose: () -> Unit,
    onSave: (Customer, Quote) -> Unit,
    onSaveAsNew: ((Customer, Quote) -> Unit)? = null
) {
    val context = LocalContext.current
    val accountId = onebizCloudUserId(context)
    val draftId = rememberSaveable(accountId, initialQuote?.id, isCopyMode) { nextId }
    var selected by remember(initialQuote) { mutableStateOf<Customer?>(customers.firstOrNull { c -> initialQuote != null && c.name == initialQuote.customer && c.phone == initialQuote.phone }) }
    var customerQuery by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.customer ?: "") }
    var name by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.customer ?: "") }
    var phone by rememberSaveable(draftId, accountId) { mutableStateOf((initialQuote?.phone ?: "").filter(Char::isDigit).take(11)) }
    var address by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.address ?: "") }
    var customerAddressDetail by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.customerAddressDetail ?: "") }
    var site by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.siteAddress ?: "") }
    var siteDetail by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.siteAddressDetail ?: "") }
    val originalItems = remember(draftId, accountId) { initialQuote?.items ?: listOf(QuoteItem("", 1, 0)) }
    var items by rememberSaveable(draftId, accountId, stateSaver = quoteItemsSaver) { mutableStateOf(originalItems) }
    var vat by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.vatEnabled ?: true) }
    var discountText by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.discountAmount?.takeIf { it > 0 }?.let(::decimalInputText) ?: "") }
    var validityText by rememberSaveable(draftId, accountId) { mutableStateOf((initialQuote?.validityDays ?: 15).toString()) }
    var note by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.note ?: "") }
    var preview by remember { mutableStateOf(false) }
    var selectedTemplate by rememberSaveable(draftId, accountId) { mutableStateOf(initialQuote?.template ?: "CLASSIC") }
    val itemPhrasePool = remember(items) {
        (loadItemPhrases(context) + items.map { it.name })
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
    }
    val pricingVersion = initialQuote?.pricingVersion ?: 2
    val parsedDiscount = if (discountText.isBlank()) 0.0 else decimalInputValue(discountText)
    val discount = parsedDiscount ?: 0.0
    val amounts = calculateQuoteAmounts(items.map { PriceLine(it.qty, it.unitPrice) }, discount, vat, pricingVersion)
    val supply = amounts.supply
    val discountedSupply = amounts.discountedSupply
    val vatValue = amounts.vat
    val total = amounts.total
    val validationMessage = when {
        items.isEmpty() || items.any { it.name.isBlank() || it.qty <= 0 || it.unitPrice <= 0 || it.inputError.isNotBlank() } -> "모든 품목의 이름·수량·단가를 입력해 주세요. 수량과 단가는 0보다 커야 합니다."
        parsedDiscount == null -> "할인금액은 0 이상의 숫자로, 소수 둘째 자리까지 입력해 주세요."
        amounts.error.isNotBlank() -> amounts.error
        else -> ""
    }
    val canSave = name.isNotBlank() && validationMessage.isBlank()
    val validityDays = (validityText.toIntOrNull() ?: 15).coerceIn(1, 365)
    val hasUnsavedChanges =
        name != initialQuote?.customer.orEmpty() ||
        phone != initialQuote?.phone.orEmpty().filter(Char::isDigit).take(11) ||
        address != initialQuote?.address.orEmpty() ||
        customerAddressDetail != initialQuote?.customerAddressDetail.orEmpty() ||
        site != initialQuote?.siteAddress.orEmpty() ||
        siteDetail != initialQuote?.siteAddressDetail.orEmpty() ||
        items != originalItems || vat != (initialQuote?.vatEnabled ?: true) ||
        discountText != (initialQuote?.discountAmount?.takeIf { it > 0 }?.let(::decimalInputText) ?: "") ||
        validityText != (initialQuote?.validityDays ?: 15).toString() ||
        note != initialQuote?.note.orEmpty() ||
        selectedTemplate != (initialQuote?.template ?: "CLASSIC")
    var showDiscardPrompt by remember { mutableStateOf(false) }
    fun requestClose() {
        if (hasUnsavedChanges) showDiscardPrompt = true else onClose()
    }
    BackHandler { requestClose() }

    Surface(Modifier.fillMaxSize(), color = Bg) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().background(Color.White).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = ::requestClose) { Icon(Icons.Default.Close, "닫기") }; Column(Modifier.weight(1f)) {
                    Text(
                        when {
                            isCopyMode -> "복사하여 새 견적 작성"
                            initialQuote == null -> "견적서 작성"
                            else -> "견적서 수정"
                        },
                        fontWeight = FontWeight.Black,
                        fontSize = 21.sp
                    )
                    Text(draftId, color = Muted)
                }
            }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                if (externalConflict) Text("다른 기기에서 원본이 변경되었습니다. 현재 입력 내용은 새 견적으로 보관할 수 있습니다. 원본은 유지됩니다.", color = MaterialTheme.colorScheme.error)
                SectionTitle("1. 고객 · 현장 정보")
                if (customers.isNotEmpty()) {
                    Text("기존 고객 검색/선택", fontWeight = FontWeight.Bold)
                    OutlinedTextField(
                        customerQuery,
                        { customerQuery = it },
                        modifier = Modifier.fillMaxWidth(),
                        leadingIcon = { Icon(Icons.Default.Search, null) },
                        label = { Text("이름·전화번호 검색") },
                        singleLine = true
                    )
                    if (customerQuery.isNotBlank()) {
                        val matches = customers.filter { c -> c.name.contains(customerQuery, true) || c.phone.contains(customerQuery) }.take(6)
                        if (matches.isEmpty()) {
                            Text("일치하는 기존 고객이 없습니다. 아래에 신규 고객 정보를 입력하세요.", color = Muted, fontSize = 13.sp)
                        } else {
                            matches.forEach { c ->
                                FilterChip(
                                    selected = selected?.phone == c.phone && selected?.name == c.name,
                                    onClick = {
                                        selected = c
                                        name = c.name
                                        phone = c.phone.filter(Char::isDigit).take(11)
                                        address = c.address
                                        customerAddressDetail = c.addressDetail
                                        if (site.isBlank()) {
                                            site = c.address
                                            siteDetail = c.addressDetail
                                        }
                                        customerQuery = ""
                                    },
                                    label = { Text("${c.name}  ${c.phone}") }
                                )
                            }
                        }
                    }
                }
                OutlinedTextField(name, { name = it; selected = null }, label = { Text("고객명 *") }, modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus())
                OutlinedTextField(phone, { phone = it.filter(Char::isDigit).take(11) }, label = { Text("휴대폰번호") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), visualTransformation = PhoneVisualTransformation, modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus(), singleLine = true, placeholder = { Text("010-1234-5678") })
                Text("고객 주소는 견적 작성 화면에 표시하지 않습니다. 고객관리에서 별도로 보관됩니다.", color = Muted, fontSize = 12.sp)
                AddressAutocompleteField(
                    value = site,
                    onValueChange = { site = it },
                    label = "시공/현장 주소"
                )
                OutlinedTextField(
                    value = siteDetail,
                    onValueChange = { siteDetail = it },
                    label = { Text("현장 상세주소") },
                    placeholder = { Text("예: 하이원아파트 101동 1203호") },
                    modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus(),
                    singleLine = true
                )

                SectionTitle("2. 견적 품목")
                items.forEachIndexed { index, item ->
                    key(item.editorId) {
                    ItemEditor(
                        index = index,
                        item = item,
                        suggestions = itemPhrasePool,
                        canDelete = items.size > 1,
                        onChange = { changed -> items = items.mapIndexed { i, old -> if (i == index) changed else old } },
                        onDelete = { items = items.filterIndexed { i, _ -> i != index } },
                        onCommitPhrase = { phrase -> synchronized(OnebizSyncRuntime.lock) { if (onebizCloudUserId(context) == accountId && OnebizAccountStorage.owner(context) == accountId) saveItemPhrases(context, listOf(phrase)) } }
                    )
                    }
                }
                OutlinedButton(onClick = { items = items + QuoteItem("", 1, 0) }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) { Icon(Icons.Default.Add, null); Text("품목 추가") }

                SectionTitle("3. 금액")
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, Border)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(discountText, { discountText = it.take(24) }, label = { Text("할인금액") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), isError = parsedDiscount == null || amounts.error.isNotBlank(), suffix = { Text("원") }, modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus(), singleLine = true, placeholder = { Text("예: 100,000.50") })
                        Text("수량·단가·할인은 소수 둘째 자리까지 입력할 수 있습니다. 최종금액과 부가세는 원 단위로 반올림합니다.", color = Muted, fontSize = 12.sp)
                        MoneyLine(if (pricingVersion >= 2 && vat) "할인 후 금액(부가세 포함)" else "할인 후 공급가액", discountedSupply)
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = !vat, onCheckedChange = { vat = !it })
                            Column(Modifier.weight(1f)) {
                                Text("부가세 미포함", fontWeight = FontWeight.Bold)
                                Text(
                                    if (pricingVersion >= 2) {
                                        if (vat) "체크하지 않으면 입력 단가를 부가세 포함 금액으로 계산합니다."
                                        else "체크됨: 총 견적금액 아래에 부가세 별도로 표시합니다."
                                    } else {
                                        "기존 견적은 저장 당시 부가세 계산 방식을 유지합니다."
                                    },
                                    color = Muted,
                                    fontSize = 12.sp
                                )
                            }
                        }
                        if (vat) MoneyLine(if (pricingVersion >= 2) "포함 부가세(참고)" else "부가세 10%", vatValue)
                        OutlinedTextField(validityText, { validityText = it.filter(Char::isDigit) }, label = { Text("견적 유효기간") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), suffix = { Text("일") }, modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus(), singleLine = true)
                        HorizontalDivider(); MoneyLine("총 견적금액", total, bold = true)
                        if (!vat) Text("부가세 별도", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.End, color = MaterialTheme.colorScheme.error, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
                SectionTitle("4. 견적서 양식")
                Text("미리보기와 PDF에 적용할 디자인을 선택하세요.", color = Muted, fontSize = 13.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TemplateChip("CLASSIC", "기본형", selectedTemplate) { selectedTemplate = it }
                    TemplateChip("PURPLE", "퍼플형", selectedTemplate) { selectedTemplate = it }
                    TemplateChip("MINIMAL", "심플형", selectedTemplate) { selectedTemplate = it }
                }
                OutlinedButton(
                    onClick = { preview = true },
                    enabled = canSave,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Icon(Icons.Default.Visibility, null); Spacer(Modifier.width(6.dp)); Text("현재 내용으로 견적서 미리보기")
                }

                SectionTitle("5. 특이사항")
                if (validationMessage.isNotBlank()) Text(validationMessage, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                OutlinedTextField(note, { note = it }, placeholder = { Text("예: 배관 5m 포함, 추가 배관 별도, 주차비 별도") }, modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus().height(120.dp))
                Text("견적서를 저장하면 작성일이 일정표에 기록됩니다. 실제 공유를 완료한 뒤 발송 여부를 확인하면 발송일도 기록됩니다.",
                    color = Muted, fontSize = 13.sp)
            }
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .imePadding(),
                color = Color.White,
                tonalElevation = 8.dp,
                shadowElevation = 8.dp
            ) {
                Button(
                    onClick = {
                        val customer = Customer(name.trim(), formatMobilePhone(phone), address.trim(), customerAddressDetail.trim())
                        val quote = Quote(
                            draftId, name.trim(), formatMobilePhone(phone), address.trim(), site.trim(),
                            items.map { it.copy(name = it.name.trim()) },
                            vat, discount, validityDays, note.trim(),
                            initialQuote?.status ?: "작성중",
                            initialQuote?.createdAt ?: LocalDate.now().toString(),
                            selectedTemplate,
                            customerAddressDetail,
                            siteDetail.trim(),
                            pricingVersion = if (initialQuote == null) 2 else initialQuote.pricingVersion,
                            sentAt = if (isCopyMode) "" else initialQuote?.sentAt.orEmpty()
                        )
                        if (externalConflict) onSaveAsNew?.invoke(customer, quote) else onSave(customer, quote)
                    },
                    enabled = canSave,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 10.dp)
                        .height(54.dp),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Icon(Icons.Default.Save, null)
                    Spacer(Modifier.width(7.dp))
                    Text(
                        when {
                            externalConflict -> "입력 내용을 새 견적으로 보관"
                            isCopyMode -> "새 견적으로 저장하기"
                            initialQuote == null -> "견적 저장하기"
                            else -> "수정 내용 저장하기"
                        },
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }

    if (showDiscardPrompt) {
        AlertDialog(
            onDismissRequest = { showDiscardPrompt = false },
            title = { Text("저장하지 않은 견적서") },
            text = { Text("변경한 견적 내용이 사라집니다. 저장하지 않고 나가시겠습니까?") },
            confirmButton = { TextButton(onClick = { showDiscardPrompt = false; onClose() }) { Text("버리고 나가기") } },
            dismissButton = { TextButton(onClick = { showDiscardPrompt = false }) { Text("계속 작성") } }
        )
    }

    if (preview) {
        AlertDialog(
            onDismissRequest = { preview = false },
            title = { Text("견적서 미리보기 · ${templateLabel(selectedTemplate)}", fontWeight = FontWeight.Black) },
            text = {
                QuotePreviewCard(
                    template = selectedTemplate,
                    quoteNo = draftId,
                    customer = name,
                    phone = formatMobilePhone(phone),
                    site = listOf(site.trim(), siteDetail.trim()).filter { it.isNotBlank() }.joinToString(" "),
                    items = items.filter { it.name.isNotBlank() },
                    supply = supply,
                    discount = discount,
                    discountedSupply = discountedSupply,
                    vat = vatValue,
                    vatEnabled = vat,
                    pricingVersion = pricingVersion,
                    total = total,
                    validityDays = validityDays,
                    note = note
                )
            },
            confirmButton = { Button(onClick = { preview = false }) { Text("작성 계속") } }
        )
    }
}

@Composable
fun TemplateChip(id: String, label: String, selected: String, onSelect: (String) -> Unit) {
    FilterChip(
        selected = selected == id,
        onClick = { onSelect(id) },
        label = { Text(label) },
        leadingIcon = if (selected == id) { { Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp)) } } else null
    )
}

fun templateLabel(template: String): String = when (template) {
    "PURPLE" -> "퍼플형"
    "MINIMAL" -> "심플형"
    else -> "기본형"
}

@Composable
fun QuotePreviewCard(
    template: String,
    quoteNo: String,
    customer: String,
    phone: String,
    site: String,
    items: List<QuoteItem>,
    supply: Int,
    discount: Double,
    discountedSupply: Int,
    vat: Int,
    vatEnabled: Boolean,
    pricingVersion: Int,
    total: Int,
    validityDays: Int,
    note: String
) {
    val accent = when (template) {
        "PURPLE" -> Purple
        "MINIMAL" -> Color(0xFF202124)
        else -> Color(0xFF2457A7)
    }
    val headBg = when (template) {
        "PURPLE" -> PurpleSoft
        "MINIMAL" -> Color(0xFFF6F6F6)
        else -> BlueSoft
    }
    val shape = if (template == "MINIMAL") RoundedCornerShape(4.dp) else RoundedCornerShape(18.dp)

    Card(
        modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        border = BorderStroke(1.dp, Border),
        shape = shape
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            if (template == "PURPLE") {
                Surface(color = Purple, shape = RoundedCornerShape(14.dp)) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("하이원시스템", color = Color.White, fontWeight = FontWeight.Black, fontSize = 20.sp)
                            Text("견 적 서", color = Color.White.copy(alpha = .9f), fontSize = 13.sp)
                        }
                        Icon(Icons.Default.Description, null, tint = Color.White)
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.weight(1f)) {
                        Text(if (template == "MINIMAL") "HIWON" else "하이원시스템", color = accent, fontWeight = FontWeight.Black, fontSize = 20.sp)
                        Text("견 적 서", fontWeight = FontWeight.Black, fontSize = 23.sp)
                    }
                    Text(quoteNo, color = Muted, fontSize = 12.sp)
                }
                HorizontalDivider(color = accent)
            }

            Surface(color = headBg, shape = RoundedCornerShape(10.dp)) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("고객  ${customer.ifBlank { "미입력" }}", fontWeight = FontWeight.Bold)
                    if (phone.isNotBlank()) Text("연락처  $phone", fontSize = 13.sp, color = Muted)
                    if (site.isNotBlank()) Text("현장  $site", fontSize = 13.sp, color = Muted)
                    Text("견적번호  $quoteNo", fontSize = 12.sp, color = Muted)
                }
            }

            Text("견적 품목", fontWeight = FontWeight.Black, color = accent)
            if (items.isEmpty()) Text("품목을 입력해 주세요.", color = Muted)
            items.forEachIndexed { index, item ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Text("${index + 1}", color = Muted, modifier = Modifier.width(22.dp))
                    Column(Modifier.weight(1f)) {
                        Text(item.name, fontWeight = FontWeight.Bold)
                        if (item.spec.isNotBlank()) Text("규격  ${item.spec}", fontSize = 12.sp, color = Muted)
                        Text("${decimalInputText(item.qty)} × ${won(item.unitPrice)}", fontSize = 12.sp, color = Muted)
                    }
                    Text(won(item.qty * item.unitPrice), fontWeight = FontWeight.Bold)
                }
                if (template != "MINIMAL") HorizontalDivider(color = Border)
            }

            Surface(color = headBg, shape = RoundedCornerShape(10.dp)) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    if (discount > 0) PreviewMoneyLine("할인", -discount)
                    PreviewMoneyLine("공급가액", if (pricingVersion >= 2 && vatEnabled) discountedSupply - vat else discountedSupply)
                    if (vatEnabled) PreviewMoneyLine("부가세", vat)
                    HorizontalDivider(color = accent.copy(alpha = .35f))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("총 견적금액", fontWeight = FontWeight.Black, color = accent)
                        Text(won(total), fontWeight = FontWeight.Black, fontSize = 20.sp, color = accent)
                    }
                    if (!vatEnabled) Text("부가세 별도", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.End, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }
            }
            Text("견적 유효기간: 작성일로부터 ${validityDays}일", color = Muted, fontSize = 12.sp)
            if (note.isNotBlank()) {
                Text("특이사항", fontWeight = FontWeight.Bold)
                Text(note, fontSize = 13.sp)
            }
            Text("HIWON SYSTEM", modifier = Modifier.align(Alignment.End), fontWeight = FontWeight.Bold, color = accent)
        }
    }
}

@Composable
fun PreviewMoneyLine(label: String, value: Number) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Muted, fontSize = 13.sp)
        Text(if (value.toDouble() < 0) "-${won(-value.toDouble())}" else won(value), fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}

@Composable
fun ItemEditor(
    index: Int,
    item: QuoteItem,
    suggestions: List<String>,
    canDelete: Boolean,
    onChange: (QuoteItem) -> Unit,
    onDelete: () -> Unit,
    onCommitPhrase: (String) -> Unit = {}
) {
    val query = item.name.trim()
    var quantityText by rememberSaveable(item.editorId) { mutableStateOf(if (item.qty == 0.0) "" else decimalInputText(item.qty)) }
    var priceText by rememberSaveable(item.editorId) { mutableStateOf(if (item.unitPrice == 0.0) "" else decimalInputText(item.unitPrice)) }
    fun updateNumbers(quantity: String, price: String) {
        val q = decimalInputValue(quantity)
        val p = decimalInputValue(price)
        val error = when {
            q == null || q <= 0 -> "수량은 0보다 큰 숫자로 입력해 주세요."
            p == null || p <= 0 -> "단가는 0보다 큰 숫자로 입력해 주세요."
            else -> ""
        }
        onChange(item.copy(qty = q ?: 0.0, unitPrice = p ?: 0.0, inputError = error))
    }
    var showSpec by remember(item.spec) { mutableStateOf(item.spec.isNotBlank()) }
    val matches = remember(query, suggestions) {
        if (query.isBlank()) emptyList()
        else suggestions
            .filter { candidate ->
                !candidate.equals(query, ignoreCase = true) && itemPhraseMatches(candidate, query)
            }
            .sortedWith(
                compareByDescending<String> { it.startsWith(query, ignoreCase = true) }
                    .thenBy { it.length }
            )
            .take(4)
    }

    Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Border), shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("품목 ${index + 1}", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                if (canDelete) IconButton(onClick = onDelete) { Icon(Icons.Default.DeleteOutline, null, tint = Muted) }
            }
            OutlinedTextField(
                value = item.name,
                onValueChange = { onChange(item.copy(name = it)) },
                label = { Text("품목명") },
                placeholder = { Text("예: 시스템에어컨 / ㅅㅇ / ㅂㄱ") },
                modifier = Modifier
                    .fillMaxWidth()
                    .onebizAutoScrollOnFocus()
                    .onFocusChanged { state ->
                        if (!state.isFocused && item.name.trim().length >= 2) onCommitPhrase(item.name.trim())
                    },
                singleLine = true,
                keyboardActions = KeyboardActions(onDone = {
                    if (item.name.trim().length >= 2) onCommitPhrase(item.name.trim())
                }),
                trailingIcon = { Icon(Icons.Default.AutoAwesome, null, tint = Purple) }
            )
            if (matches.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .border(1.dp, Border, RoundedCornerShape(10.dp))
                        .background(Color.White)
                ) {
                    matches.forEachIndexed { suggestionIndex, phrase ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onChange(item.copy(name = phrase))
                                    onCommitPhrase(phrase)
                                }
                                .padding(horizontal = 12.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(phrase, modifier = Modifier.weight(1f), fontSize = 13.sp)
                        }
                        if (suggestionIndex != matches.lastIndex) HorizontalDivider(color = Border)
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = showSpec, onCheckedChange = { checked ->
                    showSpec = checked
                    if (!checked) onChange(item.copy(spec = ""))
                })
                Text("규격 입력", fontWeight = FontWeight.Bold)
            }
            if (showSpec) {
                OutlinedTextField(
                    value = item.spec,
                    onValueChange = { onChange(item.copy(spec = it)) },
                    label = { Text("규격") },
                    placeholder = { Text("예: 4Way / 18평형 / 15A") },
                    modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus(),
                    singleLine = true
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(quantityText, { quantityText = it.take(24); updateNumbers(quantityText, priceText) }, label = { Text("수량") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), isError = quantityText.isNotBlank() && (decimalInputValue(quantityText) ?: 0.0) <= 0, modifier = Modifier.weight(.35f).onebizAutoScrollOnFocus(), singleLine = true, placeholder = { Text("예: 1.5") })
                OutlinedTextField(priceText, { priceText = it.take(24); updateNumbers(quantityText, priceText) }, label = { Text("단가") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), isError = priceText.isNotBlank() && (decimalInputValue(priceText) ?: 0.0) <= 0, modifier = Modifier.weight(.65f).onebizAutoScrollOnFocus(), singleLine = true, suffix = { Text("원") }, placeholder = { Text("예: 12,500.50") })
            }
            if (item.inputError.isNotBlank()) Text(item.inputError + " 소수 둘째 자리까지 사용할 수 있습니다.", color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            Text("금액 ${won(item.qty * item.unitPrice)}", modifier = Modifier.align(Alignment.End), fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun AddCustomerDialog(
    onDismiss: () -> Unit,
    onSave: (Customer) -> Unit,
    initialCustomer: Customer? = null,
    dialogTitle: String = "고객 등록",
    saveText: String = "저장"
) {
    var name by rememberSaveable(initialCustomer?.phone, onebizCloudUserId(LocalContext.current)) { mutableStateOf(initialCustomer?.name ?: "") }
    var phone by rememberSaveable(initialCustomer?.phone, onebizCloudUserId(LocalContext.current)) { mutableStateOf((initialCustomer?.phone ?: "").filter(Char::isDigit).take(11)) }
    var address by rememberSaveable(initialCustomer?.phone, onebizCloudUserId(LocalContext.current)) { mutableStateOf(initialCustomer?.address ?: "") }
    var addressDetail by rememberSaveable(initialCustomer?.phone, onebizCloudUserId(LocalContext.current)) { mutableStateOf(initialCustomer?.addressDetail ?: "") }
    val hasUnsavedChanges = name != initialCustomer?.name.orEmpty() ||
        phone != initialCustomer?.phone.orEmpty().filter(Char::isDigit).take(11) ||
        address != initialCustomer?.address.orEmpty() ||
        addressDetail != initialCustomer?.addressDetail.orEmpty()
    var showDiscardPrompt by remember { mutableStateOf(false) }
    fun requestDismiss() {
        if (hasUnsavedChanges) showDiscardPrompt = true else onDismiss()
    }

    AlertDialog(
        onDismissRequest = ::requestDismiss,
        title = { Text(dialogTitle, fontWeight = FontWeight.Black) },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()).imePadding(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("이름") },
                    modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus(),
                    singleLine = true
                )
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it.filter(Char::isDigit).take(11) },
                    label = { Text("휴대폰") },
                    placeholder = { Text("010-1234-5678") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    visualTransformation = PhoneVisualTransformation,
                    modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus(),
                    singleLine = true
                )
                AddressAutocompleteField(
                    value = address,
                    onValueChange = { address = it },
                    label = "기본 주소"
                )
                OutlinedTextField(
                    value = addressDetail,
                    onValueChange = { addressDetail = it },
                    label = { Text("상세주소") },
                    placeholder = { Text("예: ○○아파트 101동 1203호") },
                    modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus(),
                    singleLine = true
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(Customer(name.trim(), formatMobilePhone(phone), address.trim(), addressDetail.trim())) },
                enabled = name.isNotBlank()
            ) { Text(saveText) }
        },
        dismissButton = { TextButton(onClick = ::requestDismiss) { Text("취소") } }
    )
    if (showDiscardPrompt) {
        AlertDialog(
            onDismissRequest = { showDiscardPrompt = false },
            title = { Text("저장하지 않은 고객정보") },
            text = { Text("수정한 고객정보를 저장하지 않고 나가시겠습니까?") },
            confirmButton = { TextButton(onClick = { showDiscardPrompt = false; onDismiss() }) { Text("버리고 나가기") } },
            dismissButton = { TextButton(onClick = { showDiscardPrompt = false }) { Text("계속 작성") } }
        )
    }
}

@Composable
fun AddressAutocompleteField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String = "주소"
) {
    var showSearch by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = value, onValueChange = onValueChange,
            label = { Text(label) },
            placeholder = { Text("주소검색으로 선택하거나 직접 입력") },
            modifier = Modifier.fillMaxWidth().onebizAutoScrollOnFocus(), singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { showSearch = true }),
            trailingIcon = {
                IconButton(onClick = { showSearch = true }) {
                    Icon(Icons.Default.Search, contentDescription = "주소검색 열기", tint = Purple)
                }
            }
        )
        Text("오른쪽 돋보기를 누르거나 주소를 직접 입력하세요. 상세주소는 아래 칸에 입력합니다.", color = Muted, fontSize = 11.sp)
    }
    if (showSearch) OnebizPostcodeDialog(onDismiss = { showSearch = false }, onSelected = {
        onValueChange(it); showSearch = false
    })
}

@Composable
fun PaymentDialog(remaining: Int, suggestedAmount: Int = 0, onDismiss: () -> Unit, onSave: (Int) -> Unit) {
    var value by remember(remaining, suggestedAmount) { mutableStateOf(suggestedAmount.takeIf { it > 0 }?.toString() ?: "") }
    val amount = value.toIntOrNull() ?: 0
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("입금 등록") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("전체 남은 금액 ${won(remaining)}")
                OutlinedTextField(
                    value,
                    { value = normalizeMoneyDigits(it, 10) },
                    label = { Text("입금액") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    visualTransformation = MoneyVisualTransformation,
                    suffix = { Text("원") },
                    singleLine = true
                )
                Text("원 단위 정수로 입력해 주세요. 일부 입금도 등록할 수 있습니다.", color = Muted, fontSize = 12.sp)
            }
        },
        confirmButton = { Button(onClick = { onSave(amount) }, enabled = amount in 1..remaining) { Text("입금처리") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } }
    )
}


@Composable
fun PaymentEditDialog(
    contractAmount: Int,
    currentPaidAmount: Int,
    onDismiss: () -> Unit,
    onSave: (Int) -> Unit
) {
    var value by remember(contractAmount, currentPaidAmount) { mutableStateOf(currentPaidAmount.toString()) }
    val parsedCorrected = wholeWonInputValue(value)
    val corrected = parsedCorrected ?: 0
    val remainingAfter = (contractAmount - corrected).coerceAtLeast(0)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("입금액 수정") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("총 계약금액 ${won(contractAmount)}", fontWeight = FontWeight.Bold)
                Text("현재 누적 입금액 ${won(currentPaidAmount)}", color = Muted)
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = normalizeMoneyDigits(it, 10) },
                    label = { Text("수정할 누적 입금액") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    visualTransformation = MoneyVisualTransformation,
                    suffix = { Text("원") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                MoneyLine("수정 후 미수금", remainingAfter, bold = true)
                Text(
                    "원 단위 정수로 입력해 주세요. 0원으로 수정하면 입금 전 상태로 되돌릴 수 있습니다.",
                    color = Muted,
                    fontSize = 12.sp
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(corrected) },
                enabled = parsedCorrected != null && corrected in 0..contractAmount && corrected != currentPaidAmount
            ) { Text("수정 저장") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } }
    )
}

@Composable
fun Header(title: String, sub: String) { Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { Text(title, fontSize = 28.sp, fontWeight = FontWeight.Black, color = Text); Text(sub, color = Muted) } }
@Composable
fun SectionTitle(s: String) { Text(s, fontSize = 20.sp, fontWeight = FontWeight.Black, color = Text) }
@Composable
fun Status(s: String) { Surface(shape = RoundedCornerShape(50), color = when (s) { "계약완료", "입금완료", "완납" -> GreenSoft; "미수금", "연체" -> OrangeSoft; else -> BlueSoft }) { Text(s, Modifier.padding(horizontal = 10.dp, vertical = 5.dp), color = Purple, fontSize = 12.sp, fontWeight = FontWeight.Bold) } }
@Composable
fun MoneyLine(label: String, value: Number, bold: Boolean = false) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(label, color = if (bold) Text else Muted, fontWeight = if (bold) FontWeight.Black else FontWeight.Normal); Text(won(value), fontWeight = if (bold) FontWeight.Black else FontWeight.Bold, fontSize = if (bold) 20.sp else 16.sp) } }

internal object BusinessNumberVisualTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val raw = text.text.filter(Char::isDigit).take(10)
        val out = formatBusinessNumber(raw)
        return TransformedText(AnnotatedString(out), digitOffsetMapping(raw, out))
    }
}

internal object PhoneVisualTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val raw = text.text.filter(Char::isDigit).take(11)
        val out = formatMobilePhone(raw)
        return TransformedText(AnnotatedString(out), digitOffsetMapping(raw, out))
    }
}

private object MoneyVisualTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        if (text.text.any { !it.isDigit() }) return TransformedText(text, OffsetMapping.Identity)
        val raw = text.text.filter(Char::isDigit)
        if (raw.isEmpty()) return TransformedText(AnnotatedString(""), OffsetMapping.Identity)
        val out = formatMoneyInput(raw)
        return TransformedText(AnnotatedString(out), digitOffsetMapping(raw, out))
    }
}

private fun digitOffsetMapping(raw: String, formatted: String): OffsetMapping = object : OffsetMapping {
    override fun originalToTransformed(offset: Int): Int {
        val target = offset.coerceIn(0, raw.length)
        if (target == 0) return 0
        var digitsSeen = 0
        formatted.forEachIndexed { index, ch ->
            if (ch.isDigit()) {
                digitsSeen++
                if (digitsSeen == target) {
                    var cursor = index + 1
                    while (cursor < formatted.length && !formatted[cursor].isDigit()) cursor++
                    return cursor
                }
            }
        }
        return formatted.length
    }

    override fun transformedToOriginal(offset: Int): Int {
        val end = offset.coerceIn(0, formatted.length)
        return formatted.take(end).count(Char::isDigit).coerceIn(0, raw.length)
    }
}

fun formatMobilePhone(input: String): String {
    val digits = input.filter(Char::isDigit).take(11)
    return when {
        digits.length <= 3 -> digits
        digits.length <= 7 -> "${digits.take(3)}-${digits.drop(3)}"
        else -> "${digits.take(3)}-${digits.drop(3).take(4)}-${digits.drop(7)}"
    }
}

fun defaultItemPhrases(): List<String> = listOf(
    "시스템에어컨 설치",
    "LG 시스템에어컨 설치",
    "삼성 시스템에어컨 설치",
    "4WAY 실내기 설치",
    "1WAY 실내기 설치",
    "벽걸이 에어컨 설치",
    "실외기 설치",
    "동배관 추가",
    "드레인 배관 추가",
    "전원선 추가",
    "통신선 추가",
    "실외기 앵글 설치",
    "타공 작업",
    "천장 보강 작업",
    "철거 작업",
    "냉매 보충",
    "시운전 및 점검"
)

fun saveItemPhrases(context: Context, phrases: List<String>) {
    val prefs = context.getSharedPreferences("hiwon_item_phrases", Context.MODE_PRIVATE)
    val old = prefs.getStringSet("phrases", emptySet()).orEmpty()
    val cleaned = phrases.map { it.trim() }.filter { it.length >= 2 }
    prefs.edit().putStringSet("phrases", (old.toList() + cleaned).distinct().takeLast(100).toSet()).apply()
}

fun loadItemPhrases(context: Context): List<String> =
    context.getSharedPreferences("hiwon_item_phrases", Context.MODE_PRIVATE)
        .getStringSet("phrases", emptySet()).orEmpty().toList()

private val CHOSEONG = charArrayOf('ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ')

fun koreanInitials(text: String): String = buildString {
    text.forEach { ch ->
        when {
            ch in '가'..'힣' -> {
                val index = (ch.code - '가'.code) / (21 * 28)
                append(CHOSEONG[index])
            }
            ch in 'ㄱ'..'ㅎ' -> append(ch)
            ch.isLetterOrDigit() -> append(ch.lowercaseChar())
        }
    }
}

fun itemPhraseMatches(candidate: String, query: String): Boolean {
    if (candidate.contains(query, ignoreCase = true)) return true
    val qInitial = koreanInitials(query).replace(" ", "")
    val cInitial = koreanInitials(candidate).replace(" ", "")
    return qInitial.isNotBlank() && cInitial.contains(qInitial, ignoreCase = true)
}


fun normalizeMoneyDigits(input: String, maxDigits: Int = 10): String {
    val clean = input.trim().replace(",", "")
    if (clean.any { !it.isDigit() } || clean.length > maxDigits) return clean.take(24)
    val digits = clean
    if (digits.isBlank()) return ""
    return digits.trimStart('0').ifBlank { "0" }
}

fun parseMoneyInput(input: String): Int = wholeWonInputValue(input) ?: 0
fun formatMoneyInput(input: String): String {
    val digits = input.filter(Char::isDigit).trimStart('0').ifBlank { if (input.any(Char::isDigit)) "0" else "" }
    if (digits.isBlank()) return ""
    return runCatching { NumberFormat.getNumberInstance(Locale.KOREA).format(digits.toLong()) }.getOrDefault(digits)
}

fun won(v: Number): String = "₩" + NumberFormat.getNumberInstance(Locale.KOREA).apply { maximumFractionDigits = 2 }.format(v)
fun nextQuoteId(q: List<Quote>, contracts: List<Contract> = emptyList()): String {
    val y = LocalDate.now().year
    // 삭제된 견적에서 이미 계약이 만들어졌더라도 그 견적번호를 다시 쓰지 않는다.
    val usedQuoteNumbers = q.mapNotNull { it.id.substringAfterLast('-').toIntOrNull() } +
        contracts.mapNotNull { it.quoteId.substringAfterLast('-').toIntOrNull() }
    val n = usedQuoteNumbers.maxOrNull() ?: 0
    return "Q-$y-${(n + 1).toString().padStart(3, '0')}"
}

fun contractFromQuote(q: Quote, contractId: String): Contract = Contract(
    id = contractId,
    quoteId = q.id,
    customer = q.customer,
    item = q.itemSummary,
    amount = q.total,
    signed = false,
    paidAmount = 0,
    phone = q.phone,
    address = q.address,
    contractDate = LocalDate.now().toString(),
    siteAddress = q.siteAddress,
    siteAddressDetail = q.siteAddressDetail,
    balanceAmount = q.total
)
fun nextContractId(c: List<Contract>): String { val y = LocalDate.now().year; val n = c.mapNotNull { it.id.substringAfterLast('-').toIntOrNull() }.maxOrNull() ?: 0; return "C-$y-${(n + 1).toString().padStart(3, '0')}" }

private fun appDataToJson(customers: List<Customer>, quotes: List<Quote>, contracts: List<Contract>): JSONObject {
    val root = JSONObject()
    root.put("customers", JSONArray().apply { customers.forEach { put(JSONObject().put("name", it.name).put("phone", it.phone).put("address", it.address).put("addressDetail", it.addressDetail)) } })
    root.put("quotes", JSONArray().apply { quotes.forEach { put(quoteToJson(it)) } })
    root.put("contracts", JSONArray().apply { contracts.forEach { c -> put(JSONObject().put("id", c.id).put("quoteId", c.quoteId).put("customer", c.customer).put("item", c.item).put("amount", c.amount).put("signed", c.signed).put("paidAmount", c.paidAmount).put("phone", c.phone).put("address", c.address).put("contractDate", c.contractDate).put("workDate", c.workDate).put("depositAmount", c.depositAmount).put("depositDueDate", c.depositDueDate).put("middleAmount", c.middleAmount).put("middleDueDate", c.middleDueDate).put("balanceAmount", c.balanceAmount).put("balanceDueDate", c.balanceDueDate).put("standardTerms", c.standardTerms).put("contractType", c.contractType).put("specialTerms", c.specialTerms).put("signatureName", c.signatureName).put("signaturePath", c.signaturePath).put("signatureMethod", c.signatureMethod).put("identityStatus", c.identityStatus).put("consentAccepted", c.consentAccepted).put("signedAt", c.signedAt).put("paymentHidden", c.paymentHidden).put("debtStatus", c.debtStatus).put("firstDemandAt", c.firstDemandAt).put("demandDueDate", c.demandDueDate).put("certifiedMailAt", c.certifiedMailAt).put("legalPreparedAt", c.legalPreparedAt).put("debtMemo", c.debtMemo).put("siteAddress", c.siteAddress).put("siteAddressDetail", c.siteAddressDetail).put("finalConfirmed", c.finalConfirmed).put("finalConfirmedAt", c.finalConfirmedAt)) } })
    return root
}

fun saveData(context: Context, customers: List<Customer>, quotes: List<Quote>, contracts: List<Contract>) {
    val prefs = context.getSharedPreferences("hiwon_mvp_v2", Context.MODE_PRIVATE)
    val raw = prefs.getString("data", null)?.let { JSONObject(it) }
    val current = loadData(context)
    val before = appDataToJson(current.customers, current.quotes, current.contracts)
    if (raw != null) listOf("customers", "quotes", "contracts").forEach { key ->
        check((raw.optJSONArray(key)?.length() ?: 0) == before.getJSONArray(key).length()) {
            "기기 자료를 모두 읽지 못해 저장을 중단했습니다. 기기 자료를 먼저 보관해 주세요."
        }
    }
    var recoveryNeeded = false
    val preserved = OnebizSnapshotPreservation.preserve(raw, before, appDataToJson(customers, quotes, contracts)) { recoveryNeeded = true }
    if (recoveryNeeded && !preserveOnebizBeforeModelChange(context)) return
    prefs.edit().putString("data", preserved.toString()).apply()
}

fun loadData(context: Context): AppData {
    val raw = context.getSharedPreferences("hiwon_mvp_v2", Context.MODE_PRIVATE).getString("data", null)
    if (raw == null) {
        val legacy = context.getSharedPreferences("hiwon_mvp", Context.MODE_PRIVATE).getString("app_data", null)
        if (legacy != null) {
            try {
                val r = JSONObject(legacy)
                val ca = r.optJSONArray("customers") ?: JSONArray()
                val qa = r.optJSONArray("quotes") ?: JSONArray()
                val coa = r.optJSONArray("contracts") ?: JSONArray()
                return AppData(
                    (0 until ca.length()).map { ca.getJSONObject(it).let { o -> Customer(o.optString("name"), o.optString("phone"), o.optString("address"), o.optString("addressDetail")) } },
                    (0 until qa.length()).map { idx -> qa.getJSONObject(idx).let { o -> val amount = o.optInt("amount"); Quote(o.optString("id"), o.optString("customer"), "", "", "", listOf(QuoteItem(o.optString("item", "기존 견적"), 1, amount)), false, 0.0, 14, "기존 버전에서 가져온 견적", o.optString("status", "작성중"), LocalDate.now().toString()) } },
                    (0 until coa.length()).map { coa.getJSONObject(it).let { o -> Contract(o.optString("id"), o.optString("quoteId"), o.optString("customer"), o.optString("item"), o.optInt("amount"), o.optBoolean("signed"), o.optInt("paidAmount", if (o.optBoolean("paid")) o.optInt("amount") else 0)) } }
                )
            } catch (_: Exception) { }
        }
        return AppData(emptyList(), emptyList(), emptyList())
    }
    return try {
        val r = JSONObject(raw); val ca = r.optJSONArray("customers") ?: JSONArray(); val qa = r.optJSONArray("quotes") ?: JSONArray(); val coa = r.optJSONArray("contracts") ?: JSONArray()
        AppData(
            (0 until ca.length()).map { ca.getJSONObject(it).let { o -> Customer(o.optString("name"), o.optString("phone"), o.optString("address"), o.optString("addressDetail")) } },
            (0 until qa.length()).map { quoteFromJson(qa.getJSONObject(it)) },
            (0 until coa.length()).map { coa.getJSONObject(it).let { o ->
                val amount = o.optInt("amount")
                Contract(
                    id = o.optString("id"), quoteId = o.optString("quoteId"), customer = o.optString("customer"), item = o.optString("item"),
                    amount = amount, signed = o.optBoolean("signed"), paidAmount = o.optInt("paidAmount"),
                    phone = o.optString("phone"), address = o.optString("address"),
                    contractDate = o.optString("contractDate", LocalDate.now().toString()), workDate = o.optString("workDate"),
                    depositAmount = o.optInt("depositAmount"), depositDueDate = o.optString("depositDueDate"),
                    middleAmount = o.optInt("middleAmount"), middleDueDate = o.optString("middleDueDate"),
                    balanceAmount = if (o.has("balanceAmount")) o.optInt("balanceAmount") else amount,
                    balanceDueDate = o.optString("balanceDueDate"), standardTerms = o.optString("standardTerms", defaultStandardContractTerms()), specialTerms = o.optString("specialTerms"), contractType = o.optString("contractType", "공사·설치"),
                    signatureName = o.optString("signatureName"), signaturePath = o.optString("signaturePath"), signatureMethod = o.optString("signatureMethod"), identityStatus = o.optString("identityStatus", if (o.optBoolean("signed")) "기존기록" else "미인증"), consentAccepted = o.optBoolean("consentAccepted", o.optBoolean("signed")), signedAt = o.optString("signedAt"),
                    paymentHidden = o.optBoolean("paymentHidden", false),
                    debtStatus = o.optString("debtStatus", if (o.optInt("paidAmount") >= amount) "완납" else "미수"),
                    firstDemandAt = o.optString("firstDemandAt"), demandDueDate = o.optString("demandDueDate"),
                    certifiedMailAt = o.optString("certifiedMailAt"), legalPreparedAt = o.optString("legalPreparedAt"), debtMemo = o.optString("debtMemo"),
                    siteAddress = o.optString("siteAddress"), siteAddressDetail = o.optString("siteAddressDetail"),
                    finalConfirmed = o.optBoolean("finalConfirmed", false), finalConfirmedAt = o.optString("finalConfirmedAt")
                )
            } }
        )
    } catch (_: Exception) { AppData(emptyList(), emptyList(), emptyList()) }
}


/** Guest signing uses a separate secret and never modifies cloud login, local ownership or backups. */
private fun onebizGuestSigningKey(context: Context, create: Boolean): String {
    val scope = OnebizGuestWorkspace.scope(context)
    if (!OnebizGuestWorkspace.isGuestScope(scope)) return ""
    val prefs = context.getSharedPreferences("onebiz_guest_websign", Context.MODE_PRIVATE)
    val name = "secret:" + scope
    val saved = prefs.getString(name, "").orEmpty()
    if (saved.isNotBlank() || !create) return saved
    val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
    val secret = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    check(prefs.edit().putString(name, secret).commit()) { "기기 전자서명 인증정보를 보관하지 못했습니다." }
    return secret
}

private fun onebizGuestSignRequested(context: Context, contractId: String): Boolean {
    val scope = OnebizGuestWorkspace.scope(context)
    return context.getSharedPreferences("onebiz_guest_websign", Context.MODE_PRIVATE)
        .getBoolean("requested:" + scope + ":" + contractId, false)
}

private fun onebizGuestSignContract(contract: Contract): JSONObject = JSONObject().apply {
    put("id", contract.id); put("quoteId", contract.quoteId); put("customer", contract.customer)
    put("phone", contract.phone); put("address", contract.address)
    put("siteAddress", contract.siteAddress); put("siteAddressDetail", contract.siteAddressDetail)
    put("item", contract.item); put("amount", contract.amount)
    put("contractDate", contract.contractDate); put("workDate", contract.workDate)
    put("depositAmount", contract.depositAmount); put("depositDueDate", contract.depositDueDate)
    put("middleAmount", contract.middleAmount); put("middleDueDate", contract.middleDueDate)
    put("balanceAmount", contract.balanceAmount); put("balanceDueDate", contract.balanceDueDate)
    put("standardTerms", contract.standardTerms); put("specialTerms", contract.specialTerms)
    put("contractType", contract.contractType); put("signed", contract.signed)
}

private fun onebizGuestSignRequest(
    context: Context, secret: String, path: String, contract: Contract, confirm: Boolean
): Triple<Boolean, Int, String> {
    return try {
        val url = URL(ONEBIZ_CLOUD_BASE_URL + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 12000
            readTimeout = 60000
            setRequestProperty("X-Onebiz-Client", "android")
            setRequestProperty("X-Onebiz-Guest-Sign-Key", secret)
            setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            doOutput = true
        }
        try {
            val payload = JSONObject().put("contract", onebizGuestSignContract(contract)).put("confirm", confirm)
            conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val result = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            Triple(code in 200..299, code, result)
        } finally { conn.disconnect() }
    } catch (e: Exception) {
        Triple(false, 0, e.message ?: "전자서명 서버 연결 오류")
    }
}

private fun fetchOnebizGuestSignStatus(context: Context, contract: Contract): Contract? {
    val scope = OnebizGuestWorkspace.scope(context)
    val secret = onebizGuestSigningKey(context, false)
    if (secret.isBlank() || !onebizGuestSignRequested(context, contract.id)) return null
    val (ok, _, body) = onebizGuestSignRequest(
        context, secret, "/api/guest-sign/status", contract, false
    )
    if (!ok) return null
    val response = runCatching { JSONObject(body) }.getOrNull() ?: return null
    if (!response.optBoolean("signed", false)) return null
    if (scope != OnebizGuestWorkspace.scope(context) || secret != onebizGuestSigningKey(context, false)) return null
    return contract.copy(
        signed = true,
        signatureName = response.optString("signatureName").ifBlank { contract.customer },
        signatureMethod = "카카오톡 웹서명",
        identityStatus = response.optString("identityStatus", "웹서명 확인"),
        consentAccepted = true,
        signedAt = response.optString("signedAt")
    )
}

private fun shareOnebizGuestSignedOriginal(context: Context, contract: Contract): Boolean {
    val scope = OnebizGuestWorkspace.scope(context)
    val signUrl = context.getSharedPreferences("onebiz_guest_websign", Context.MODE_PRIVATE)
        .getString("signurl:" + scope + ":" + contract.id, "").orEmpty()
    val parsed = Uri.parse(signUrl)
    if (parsed.scheme != "https" || parsed.host != "hiwon-websign-server.onrender.com" ||
        !parsed.path.orEmpty().startsWith("/sign/")) {
        Toast.makeText(context, "서명 원본 링크가 없습니다. 기존 계약서 PDF를 확인해 주세요.", Toast.LENGTH_LONG).show()
        return false
    }
    val originalUrl = signUrl.replaceFirst("/sign/", "/receipt/")
    val message = "[ONEBIZ 원비즈 체결 계약서]\\n" + contract.customer +
        " 고객님, 서명 완료된 계약서 원본을 확인해 주세요.\\n" + originalUrl
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, message)
        setPackage("com.kakao.talk")
    }
    return try {
        try { context.startActivity(send) }
        catch (_: Exception) {
            send.setPackage(null)
            context.startActivity(Intent.createChooser(send, "체결 계약서 원본 보내기"))
        }
        true
    } catch (e: Exception) {
        Toast.makeText(context, "원본 공유 실패: " + (e.message ?: "공유 앱 오류"), Toast.LENGTH_LONG).show()
        false
    }
}

private fun shareOnebizGuestKakaoSignRequest(context: Context, contract: Contract): Boolean {
    if (contract.signed) return shareContractPdf(context, contract)
    if (!Regex("^010[0-9]{8}$").matches(contract.phone.filter(Char::isDigit))) {
        Toast.makeText(context, "고객 휴대폰번호를 확인해 주세요.", Toast.LENGTH_LONG).show()
        return false
    }
    android.app.AlertDialog.Builder(context)
        .setTitle("카카오톡 전자서명 요청")
        .setMessage("선택한 계약서 내용을 전자서명 서버에 안전하게 보관하고 고객에게 서명 링크를 보냅니다. 진행하시겠습니까?")
        .setNegativeButton("취소", null)
        .setPositiveButton("동의하고 보내기") { _, _ ->
            val scope = OnebizGuestWorkspace.scope(context)
            Thread {
                try {
                    val key = onebizGuestSigningKey(context, true)
                    val (ok, code, body) = onebizGuestSignRequest(
                        context, key, "/api/guest-sign/link", contract, true
                    )
                    if (!ok) error(onebizErrorMessage(code, body))
                    val url = JSONObject(body).optString("signUrl")
                    val parsed = Uri.parse(url)
                    check(parsed.scheme == "https" && parsed.host == "hiwon-websign-server.onrender.com") {
                        "전자서명 주소를 확인할 수 없습니다."
                    }
                    check(scope == OnebizGuestWorkspace.scope(context)) { "기기 문서함이 변경되었습니다." }
                    val prefs = context.getSharedPreferences("onebiz_guest_websign", Context.MODE_PRIVATE)
                    check(prefs.edit()
                        .putBoolean("requested:" + scope + ":" + contract.id, true)
                        .putString("signurl:" + scope + ":" + contract.id, url).commit()) {
                        "서명 요청 기록을 저장하지 못했습니다."
                    }
                    val message = buildString {
                        appendLine("[ONEBIZ 원비즈 전자계약]")
                        appendLine(contract.customer + " 고객님, 계약서를 확인하고 서명해 주세요.")
                        appendLine("계약번호: " + contract.id)
                        appendLine("계약금액: " + won(contract.amount))
                        appendLine()
                        appendLine("계약서 확인 및 서명하기")
                        appendLine(url)
                    }
                    Handler(Looper.getMainLooper()).post {
                        if (scope == OnebizGuestWorkspace.scope(context)) {
                            val send = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, message)
                                setPackage("com.kakao.talk")
                            }
                            try { context.startActivity(send) }
                            catch (_: Exception) {
                                send.setPackage(null)
                                context.startActivity(Intent.createChooser(send, "계약서 서명 요청 보내기"))
                            }
                        }
                    }
                } catch (e: Exception) {
                    Handler(Looper.getMainLooper()).post {
                        Toast.makeText(context, "서명 요청 실패: " + (e.message ?: "연결 오류"), Toast.LENGTH_LONG).show()
                    }
                }
            }.start()
        }
        .show()
    return true
}

// Web signing is requested only through the authenticated ONEBIZ server.
// Never embed the signing service's X-App-Key inside an Android APK.
suspend fun fetchWebSignStatus(context: Context, contract: Contract): Contract? = withContext(Dispatchers.IO) {
    val token = onebizCloudToken(context)
    val checkingUserId = onebizCloudUserId(context)
    if (OnebizGuestWorkspace.isActive(context)) {
        return@withContext fetchOnebizGuestSignStatus(context, contract)
    }
    if (token.isBlank()) return@withContext null
    val request = JSONObject().put("contractId", contract.id)
    val (ok, _, response) = onebizCloudRequest("POST", "/api/contract/sign-status", request, token)
    if (!ok) return@withContext null
    val json = runCatching { JSONObject(response) }.getOrNull() ?: return@withContext null
    if (!json.optBoolean("signed", false)) return@withContext null
    if (!onebizSessionMatches(context, token, checkingUserId)) return@withContext null
    DocumentCenterRepository.invalidate(context, checkingUserId, token)
    contract.copy(
        signed = true,
        signatureName = json.optString("signatureName").ifBlank { contract.customer },
        signatureMethod = "카카오톡 웹서명",
        identityStatus = json.optString("identityStatus", "본인확인 완료"),
        consentAccepted = true,
        signedAt = json.optString("signedAt")
    )
}

private fun createOnebizWebSignUrl(contract: Contract, guard: OnebizSendPreflight): String {
    val req = JSONObject().put("contractId", contract.id)
    val (ok, code, response) = guard.request("POST", "/api/contract/sign-link", req)
    if (!ok) error("서명 링크 생성 실패: " + onebizErrorMessage(code, response))
    val url = JSONObject(response).optString("signUrl")
    val host = runCatching { Uri.parse(url) }.getOrNull()
    check(host?.scheme == "https" && host.host == "hiwon-websign-server.onrender.com" && url.isNotBlank()) {
        "원비즈 전자서명 링크를 확인할 수 없습니다."
    }
    return url
}

fun sendOnebizContractSignAlimtalk(context: Context, contract: Contract, expectedUserId: String, expectedToken: String) {
    val token = expectedToken
    val sendingUserId = expectedUserId
    if (token.isBlank()) {
        Toast.makeText(context, "원비즈 계정 로그인이 필요합니다.", Toast.LENGTH_LONG).show()
        return
    }
    if (contract.signed) {
        Toast.makeText(context, "이미 서명이 완료된 계약서입니다.", Toast.LENGTH_LONG).show()
        return
    }
    if (!Regex("^010[0-9]{8}$").matches(contract.phone.filter(Char::isDigit))) {
        Toast.makeText(context, "계약서에 저장된 고객 휴대폰 번호를 확인해 주세요.", Toast.LENGTH_LONG).show()
        return
    }
    val guard = runCatching { OnebizSendPreflight.capture(context, sendingUserId, token, contract = contract) }
        .getOrElse { Toast.makeText(context, it.message ?: ONEBIZ_SEND_SYNC_HELP, Toast.LENGTH_LONG).show(); return }
    Toast.makeText(context, "계약 저장·동기화 및 SOLAPI 연결을 확인합니다.", Toast.LENGTH_SHORT).show()
    Thread {
        var result = "알림톡을 발송하지 않았습니다."
        try {
          guard.whenReady {
            // Preflight avoids creating duplicate signing requests while SOLAPI is blocked.
            val preflight = JSONObject().put("contractId", contract.id)
            val (preOk, preCode, preBody) = guard.request(
                "POST", "/api/alimtalk/customer/contract/preflight", preflight
            )
            if (!preOk) {
                result = "알림톡 사전확인 실패 · " + onebizErrorMessage(preCode, preBody)
            } else {
                val info = JSONObject(preBody)
                if (!info.optBoolean("sendEnabled", false)) {
                    result = info.optString("reason").ifBlank {
                        "SOLAPI 계정 인증 또는 승인 템플릿 확인 중이므로 알림톡이 발송되지 않았습니다."
                    }
                } else {
                    val signUrl = createOnebizWebSignUrl(contract, guard)
                    val payload = JSONObject().apply {
                        put("kind", "contractSign")
                        put("contractId", contract.id)
                        put("signUrl", signUrl)
                    }
                    val (previewOk, previewCode, previewBody) = guard.request(
                        "POST", "/api/alimtalk/customer/preview", payload
                    )
                    if (!previewOk) {
                        result = "알림톡 발송 전 검증 실패 · " + onebizErrorMessage(previewCode, previewBody)
                    } else if (!JSONObject(previewBody).optBoolean("sendEnabled", false)) {
                        result = "SOLAPI 연결이 제한되어 알림톡을 전송하지 않았습니다. 일반 카카오톡 공유를 이용해 주세요."
                    } else {
                        payload.put("confirm", true)
                        val (ok, code, response) = guard.request(
                            "POST", "/api/alimtalk/customer/send", payload
                        )
                        val outcome = onebizSendOutcome(ok, code, response)
                        if (outcome != OnebizSendOutcome.FAILED) DocumentCenterRepository.invalidate(context, sendingUserId, token)
                        result = when (outcome) {
                            OnebizSendOutcome.ACCEPTED -> "SOLAPI 발송 요청이 접수됐습니다. 실제 고객 수신은 SOLAPI 발송내역에서 확인해야 합니다."
                            OnebizSendOutcome.UNKNOWN -> ONEBIZ_SEND_UNKNOWN_MESSAGE
                            OnebizSendOutcome.FAILED -> "알림톡 전송 실패 · " + onebizErrorMessage(code, response)
                        }
                    }
                }
            }
          }
        } catch (e: Exception) {
            result = e.message ?: "발송 준비를 완료하지 못했습니다. $ONEBIZ_SEND_SYNC_HELP"
        }
        Handler(Looper.getMainLooper()).post {
            if (guard.sessionIsCurrent()) Toast.makeText(context, result, Toast.LENGTH_LONG).show()
        }
    }.start()
}

fun shareKakaoSignRequest(context: Context, contract: Contract, expectedUserId: String, expectedToken: String): Boolean {
    val token = expectedToken
    val sendingUserId = expectedUserId
    if (token.isBlank()) {
        Toast.makeText(context, "원비즈 계정에 먼저 로그인해 주세요.", Toast.LENGTH_LONG).show()
        return false
    }
    val guard = runCatching { OnebizSendPreflight.capture(context, sendingUserId, token, contract = contract) }
        .getOrElse { Toast.makeText(context, it.message ?: ONEBIZ_SEND_SYNC_HELP, Toast.LENGTH_LONG).show(); return false }
    Toast.makeText(context, "계약 저장·동기화와 서명 링크를 확인합니다.", Toast.LENGTH_SHORT).show()
    Thread {
        try {
          guard.whenReady {
            val signUrl = createOnebizWebSignUrl(contract, guard)
            val message = buildString {
                appendLine("[ONEBIZ 원비즈 전자계약]")
                appendLine("${contract.customer} 고객님, 계약서를 확인하고 서명해 주세요.")
                appendLine("계약번호: ${contract.id}")
                appendLine("계약금액: ${won(contract.amount)}")
                if (contract.workDate.isNotBlank()) appendLine("시공예정일: ${contract.workDate}")
                appendLine()
                appendLine("계약서 확인 및 서명하기")
                appendLine(signUrl)
                appendLine("※ 별도 앱 설치 없이 휴대폰에서 바로 서명할 수 있습니다.")
            }
            Handler(Looper.getMainLooper()).post {
                try {
                    guard.checkReady()
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, message)
                        putExtra(Intent.EXTRA_SUBJECT, "${contract.id} 계약서 서명 요청")
                        setPackage("com.kakao.talk")
                    }
                    try { context.startActivity(send) }
                    catch (_: Exception) {
                        send.setPackage(null)
                        context.startActivity(Intent.createChooser(send, "계약서 서명 요청 보내기"))
                    }
                } catch (_: Exception) {
                    if (guard.sessionIsCurrent()) Toast.makeText(context, "자료가 바뀌었거나 공유를 열지 못했습니다. 계약을 다시 확인해 주세요.", Toast.LENGTH_SHORT).show()
                }
            }
          }
        } catch (e: Exception) {
            Handler(Looper.getMainLooper()).post {
                if (guard.sessionIsCurrent()) Toast.makeText(context, "서명 링크 생성 실패: ${e.message ?: "서버 연결 오류"}", Toast.LENGTH_LONG).show()
            }
        }
    }.start()
    return true
}

fun shareContractPdf(context: Context, contract: Contract): Boolean {
    return try {
        val dir = File(context.cacheDir, "share").apply { mkdirs() }
        val file = File(dir, "${contract.id}_${contract.customer}_계약서.pdf")
        val pdf = PdfDocument()
        val business = loadBusinessProfile(context)
        val purple = android.graphics.Color.rgb(91, 67, 214)
        val linePaint = Paint().apply { color = purple; strokeWidth = 1.5f }
        val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = purple; textSize = 24f; typeface = android.graphics.Typeface.DEFAULT_BOLD }
        val bold = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.BLACK; textSize = 13f; typeface = android.graphics.Typeface.DEFAULT_BOLD }
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.DKGRAY; textSize = 11f }
        val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.GRAY; textSize = 9.5f }
        val money = NumberFormat.getNumberInstance(Locale.KOREA)

        // A4 1페이지: 계약 핵심내용과 서명
        val page1 = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
        val c1 = page1.canvas
        var y = 48f
        c1.drawText(business.businessName.ifBlank { "사업자 정보 미등록" }, 40f, y, title)
        c1.drawText("${contract.contractType} 계약서", 40f, y + 22f, bold)
        c1.drawText(contract.id, 435f, y, small)
        c1.drawText("견적 ${contract.quoteId}", 435f, y + 16f, small)
        y += 43f
        c1.drawLine(40f, y, 555f, y, Paint().apply { color = purple; strokeWidth = 2.5f }); y += 18f
        c1.drawText("공급자", 45f, y, bold); c1.drawText(business.businessName.ifBlank { "미등록" }, 110f, y, text); y += 17f
        c1.drawText("대표자", 45f, y, bold); c1.drawText(business.representative.ifBlank { "-" }, 110f, y, text)
        c1.drawText("사업자번호", 300f, y, bold); c1.drawText(business.registrationNo.ifBlank { "-" }, 390f, y, text); y += 17f
        c1.drawText("사업장", 45f, y, bold); c1.drawText(business.fullAddress.ifBlank { "-" }.take(72), 110f, y, text); y += 17f
        if (business.phone.isNotBlank()) { c1.drawText("연락처", 45f, y, bold); c1.drawText(business.phone, 110f, y, text); y += 19f }
        c1.drawLine(40f, y, 555f, y, Paint().apply { color = android.graphics.Color.LTGRAY; strokeWidth = 1f }); y += 20f

        c1.drawText("계약 상대방", 45f, y, bold); y += 20f
        c1.drawText("고객명  ${contract.customer}", 45f, y, text); y += 17f
        c1.drawText("연락처  ${contract.phone.ifBlank { "-" }}", 45f, y, text); y += 17f
        c1.drawText("현장주소  ${fullSiteAddress(contract).ifBlank { "미등록" }.take(72)}", 45f, y, text); y += 23f

        c1.drawText("계약내용", 45f, y, bold); y += 19f
        contract.item.chunked(70).take(2).forEach { c1.drawText(it, 45f, y, text); y += 16f }
        y += 6f
        c1.drawText("총 계약금액", 45f, y, bold)
        c1.drawText("₩${money.format(contract.amount)}", 390f, y, title); y += 32f
        c1.drawLine(40f, y, 555f, y, linePaint); y += 20f

        c1.drawText("계약일", 45f, y, bold); c1.drawText(contract.contractDate, 155f, y, text)
        c1.drawText("시공예정일", 310f, y, bold); c1.drawText(contract.workDate.ifBlank { "미정" }, 410f, y, text); y += 28f
        c1.drawText("지급 구분", 45f, y, bold); c1.drawText("금액", 245f, y, bold); c1.drawText("지급예정일", 405f, y, bold); y += 10f
        c1.drawLine(40f, y, 555f, y, linePaint); y += 20f
        listOf(
            Triple("계약금", contract.depositAmount, contract.depositDueDate),
            Triple("중도금", contract.middleAmount, contract.middleDueDate),
            Triple("잔금", contract.balanceAmount, contract.balanceDueDate)
        ).forEach { (label, amount, due) ->
            c1.drawText(label, 45f, y, text); c1.drawText("₩${money.format(amount)}", 245f, y, text); c1.drawText(due.ifBlank { "미정" }, 405f, y, text); y += 23f
        }
        y += 8f
        if (contract.specialTerms.isNotBlank()) {
            c1.drawText("현장 특약사항", 45f, y, bold); y += 18f
            contract.specialTerms.lines().flatMap { it.chunked(70) }.take(5).forEach { line -> c1.drawText(line, 45f, y, small); y += 13f }
            y += 6f
        }
        c1.drawLine(40f, y, 555f, y, Paint().apply { color = android.graphics.Color.LTGRAY; strokeWidth = 1f }); y += 20f
        c1.drawText("전자서명", 45f, y, bold); y += 18f
        c1.drawText("서명자  ${contract.signatureName.ifBlank { if (contract.signed) contract.customer else "________________" }}", 45f, y, text); y += 16f
        c1.drawText("서명방식  ${contract.signatureMethod.ifBlank { if (contract.signed) "전자서명" else "서명 전" }}", 45f, y, small); y += 14f
        c1.drawText("본인확인  ${contract.identityStatus}    서명일  ${contract.signedAt.ifBlank { "-" }}", 45f, y, small)
        if (contract.finalConfirmed) c1.drawText("최종확인 완료  ${contract.finalConfirmedAt}", 340f, y, small)

        // 공급자 직인은 고객 서명 왼쪽에 배치하며, 체결 전 계약서에는 날인하지 않습니다.
        val signatureBoxTop = (y + 18f).coerceAtMost(730f)
        if (contract.signed) {
            val supplierName = listOf(business.businessName, business.representative)
                .filter { it.isNotBlank() }.joinToString(" · ")
            if (supplierName.isNotBlank()) {
                c1.drawText("공급자 확인", 45f, signatureBoxTop + 14f, bold)
                c1.drawText(fitPaymentPdfText(supplierName, small, 175f), 45f, signatureBoxTop + 32f, small)
                drawCompanyElectronicSeal(c1, 280f, signatureBoxTop + 23f, business, 22f)
            }
        }
        if (contract.signaturePath.isNotBlank()) {
            val parsed = parseSignature(contract.signaturePath)
            val all = parsed.flatten()
            if (all.isNotEmpty()) {
                val minX = all.minOf { it.first }; val maxX = all.maxOf { it.first }
                val minY = all.minOf { it.second }; val maxY = all.maxOf { it.second }
                val width = (maxX - minX).coerceAtLeast(1f); val height = (maxY - minY).coerceAtLeast(1f)
                val boxLeft = 360f; val boxTop = signatureBoxTop; val boxW = 150f; val boxH = 45f
                val scale = minOf(boxW / width, boxH / height)
                val signPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.BLACK; strokeWidth = 2f; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
                parsed.forEach { stroke -> stroke.zipWithNext().forEach { (a, b) -> c1.drawLine(boxLeft + (a.first-minX)*scale, boxTop + (a.second-minY)*scale, boxLeft + (b.first-minX)*scale, boxTop + (b.second-minY)*scale, signPaint) } }
            }
        }
        c1.drawText("A4 210×297mm · 1/2", 470f, 815f, small)
        pdf.finishPage(page1)

        // A4 2페이지: 표준 계약조건
        val page2 = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, 2).create())
        val c2 = page2.canvas
        var y2 = 50f
        c2.drawText("표준 계약조건", 40f, y2, title); y2 += 28f
        c2.drawText("계약번호 ${contract.id} · ${business.businessName.ifBlank { "사업자 미등록" }}", 40f, y2, small); y2 += 20f
        c2.drawLine(40f, y2, 555f, y2, linePaint); y2 += 22f
        val terms = contract.standardTerms.ifBlank { defaultStandardContractTerms() }
        terms.lines().forEach { paragraph ->
            var remaining = paragraph
            while (remaining.isNotEmpty() && y2 < 790f) {
                val count = remaining.indices.takeWhile { small.measureText(remaining, 0, it + 1) <= 505f }.size.coerceAtLeast(1)
                c2.drawText(remaining.take(count), 45f, y2, small)
                remaining = remaining.drop(count)
                y2 += 15f
            }
        }
        c2.drawText("A4 210×297mm · 2/2", 470f, 815f, small)
        pdf.finishPage(page2)

        FileOutputStream(file).use { pdf.writeTo(it) }; pdf.close()
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            setType("application/pdf")
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "${contract.id} ${contract.customer} 계약서")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "계약서 PDF 공유"))
        true
    } catch (e: Exception) {
        Toast.makeText(context, "계약서 PDF를 생성하지 못했습니다: ${e.message ?: "오류"}", Toast.LENGTH_SHORT).show()
        false
    }
}

fun shareQuotePdf(context: Context, q: Quote, kakaoOnly: Boolean = false): Boolean {
    try {
        val dir = File(context.cacheDir, "share").apply { mkdirs() }
        val file = File(dir, "${q.id}_${q.customer}.pdf")
        val pdf = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(595, 842, 1).create()
        val page = pdf.startPage(pageInfo)
        val c = page.canvas

        val accent = when (q.template) {
            "PURPLE" -> android.graphics.Color.rgb(91, 67, 214)
            "MINIMAL" -> android.graphics.Color.rgb(32, 33, 36)
            else -> android.graphics.Color.rgb(36, 87, 167)
        }
        val light = when (q.template) {
            "PURPLE" -> android.graphics.Color.rgb(240, 235, 255)
            "MINIMAL" -> android.graphics.Color.rgb(246, 246, 246)
            else -> android.graphics.Color.rgb(234, 244, 255)
        }
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.BLACK; textSize = 14f }
        val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.DKGRAY; textSize = 10.5f }
        val title = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent; textSize = 23f; typeface = android.graphics.Typeface.DEFAULT_BOLD }
        val bold = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.BLACK; textSize = 15f; typeface = android.graphics.Typeface.DEFAULT_BOLD }
        val accentBold = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent; textSize = 17f; typeface = android.graphics.Typeface.DEFAULT_BOLD }
        val money = NumberFormat.getNumberInstance(Locale.KOREA)
        val business = loadBusinessProfile(context)
        var y = 55f

        if (q.template == "PURPLE") {
            val box = Paint().apply { color = accent }
            c.drawRoundRect(30f, 28f, 565f, 103f, 14f, 14f, box)
            val whiteTitle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE; textSize = 22f; typeface = android.graphics.Typeface.DEFAULT_BOLD }
            val whiteSmall = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE; textSize = 11f }
            c.drawText(business.businessName.ifBlank { "사업자 미등록" }.take(28), 48f, 61f, whiteTitle)
            c.drawText("견적서", 48f, 84f, whiteSmall)
            c.drawText(q.id, 440f, 62f, whiteSmall)
            c.drawText(q.createdAt, 440f, 82f, whiteSmall)
            y = 130f
        } else {
            c.drawText(business.businessName.ifBlank { if (q.template == "MINIMAL") "HIWON" else "사업자 정보 미등록" }.take(30), 40f, y, title)
            c.drawText("견적서", 40f, y + 26, bold)
            c.drawText(q.id, 440f, y, small)
            c.drawText(q.createdAt, 440f, y + 18, small)
            y += 48
            c.drawLine(40f, y, 555f, y, Paint().apply { color = accent; strokeWidth = if (q.template == "MINIMAL") 1f else 3f })
            y += 28
        }

        c.drawText("공급자  ${business.businessName.ifBlank { "미등록" }} · 대표 ${business.representative.ifBlank { "-" }} · 사업자번호 ${business.registrationNo.ifBlank { "-" }}", 45f, y, small); y += 15f
        if (business.fullAddress.isNotBlank()) { c.drawText("사업장  ${business.fullAddress.take(82)}", 45f, y, small); y += 15f }
        val infoBg = Paint().apply { color = light }
        c.drawRoundRect(40f, y - 12f, 555f, y + 58f, 10f, 10f, infoBg)
        c.drawText("고객명  ${q.customer}", 55f, y + 8f, bold)
        c.drawText("연락처  ${q.phone}", 55f, y + 29f, small)
        c.drawText("현장주소  ${fullSiteAddress(q).ifBlank { "미등록" }.take(74)}", 55f, y + 50f, small)
        y += 88f

        c.drawText("품목", 45f, y, bold)
        c.drawText("수량", 320f, y, bold)
        c.drawText("단가", 365f, y, bold)
        c.drawText("금액", 475f, y, bold)
        y += 10f
        c.drawLine(40f, y, 555f, y, Paint().apply { color = accent; strokeWidth = 1.5f })
        y += 20f

        q.items.forEach { i ->
            c.drawText(i.name.take(34), 45f, y, small)
            c.drawText(decimalInputText(i.qty), 325f, y, small)
            c.drawText(money.format(i.unitPrice), 365f, y, small)
            c.drawText(money.format(i.qty * i.unitPrice), 475f, y, small)
            y += 16f
            if (i.spec.isNotBlank()) { c.drawText("규격: ${i.spec.take(45)}", 58f, y, small); y += 15f }
            else y += 5f
            if (q.template != "MINIMAL") c.drawLine(45f, y - 7f, 555f, y - 7f, Paint().apply { color = android.graphics.Color.LTGRAY; strokeWidth = .5f })
        }

        y += 12f
        c.drawLine(330f, y, 555f, y, Paint().apply { color = accent; strokeWidth = 1f })
        y += 24f
        if (q.discountAmount > 0) { c.drawText("할인", 360f, y, textPaint); c.drawText("-" + money.format(q.discountAmount), 470f, y, textPaint); y += 21f }
        val pdfSupply = if (q.usesVatIncludedPricing && q.vatEnabled) q.discountedSupply - q.vat else q.discountedSupply
        c.drawText("공급가액", 360f, y, textPaint); c.drawText(money.format(pdfSupply), 470f, y, textPaint); y += 21f
        if (q.vatEnabled) {
            c.drawText("부가세", 360f, y, textPaint); c.drawText(money.format(q.vat), 470f, y, textPaint); y += 21f
        }
        c.drawText("총 견적금액", 360f, y, accentBold); c.drawText(money.format(q.total), 455f, y, accentBold); y += 22f
        if (!q.vatEnabled) { c.drawText("부가세 별도", 470f, y, small); y += 19f } else y += 14f

        c.drawText("견적 유효기간: ${q.validUntil}", 40f, y, small); y += 20f
        if (q.note.isNotBlank()) c.drawText("특이사항: ${q.note.take(78)}", 40f, y, small)
        c.drawText("${business.businessName.ifBlank { "사업자 미등록" }} · A4 인쇄용 · ${templateLabel(q.template)}", 40f, 800f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent; textSize = 12f; typeface = android.graphics.Typeface.DEFAULT_BOLD })

        pdf.finishPage(page)
        FileOutputStream(file).use { pdf.writeTo(it) }
        pdf.close()
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "${q.id} ${q.customer} 견적서")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (kakaoOnly) {
            val kakaoIntent = Intent(intent).apply { setPackage("com.kakao.talk") }
            if (kakaoIntent.resolveActivity(context.packageManager) != null) {
                context.startActivity(kakaoIntent)
                Toast.makeText(context, "카카오톡에서 고객 채팅방을 선택해 견적서를 보내주세요.", Toast.LENGTH_LONG).show()
                return true
            }
            Toast.makeText(context, "카카오톡이 설치되어 있지 않아 공유 화면을 엽니다.", Toast.LENGTH_SHORT).show()
        }
        context.startActivity(Intent.createChooser(intent, if (kakaoOnly) "견적서 보내기" else "견적서 PDF 공유"))
        return true
    } catch (_: Exception) {
        Toast.makeText(context, "견적서 공유를 시작하지 못했습니다.", Toast.LENGTH_SHORT).show()
        return false
    }
}