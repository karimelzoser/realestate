import type { AppLocale } from './locale';

export const authMessages: Record<
  AppLocale,
  {
    login: {
      brandEyebrow: string;
      brandTitle: string;
      brandBody: string;
      brandFoot: string;
      secureAccess: string;
      signIn: string;
      enterOtp: string;
      intro: string;
      otpIntro: string;
      methodLabel: string;
      phoneTab: string;
      nationalIdTab: string;
      phoneLabel: string;
      nationalIdLabel: string;
      nationalIdPlaceholder: string;
      phoneHint: string;
      nationalIdHint: string;
      checking: string;
      continueOtp: string;
      or: string;
      continueGoogle: string;
      securityNote: string;
      genericStartError: string;
      genericStartFailure: string;
      genericOtpNotice: string;
      invalidOtp: string;
      verifyFailure: string;
      otpLabel: string;
      otpPlaceholder: string;
      verifying: string;
      verifySignIn: string;
      anotherMethod: string;
    };
    accessPending: {
      identityVerified: string;
      title: string;
      body: string;
      foot: string;
      accessControl: string;
      waiting: string;
      waitingBody: string;
      notice: string;
      returnSignIn: string;
    };
    verifyAccount: {
      accountVerification: string;
      verifiedTitle: string;
      verifiedBody: string;
      continueSignIn: string;
      secureEnrollment: string;
      title: string;
      body: string;
      phoneLabel: string;
      codeLabel: string;
      verifying: string;
      verify: string;
      help: string;
      error: string;
    };
  }
> = {
  en: {
    login: {
      brandEyebrow: 'Real Estate Operating System',
      brandTitle: 'One secure entry to every property workflow.',
      brandBody:
        'Buyers, brokers and authorized project teams enter the same platform with the permissions, project scope and data visibility assigned to their account.',
      brandFoot: 'Identity protected • Activity audited • Access scoped',
      secureAccess: 'Secure access',
      signIn: 'Sign in to PRENEURA',
      enterOtp: 'Enter your one-time code',
      intro: 'No password is required. Choose the easiest verified method for your account.',
      otpIntro: 'The code expires quickly and can only be used once.',
      methodLabel: 'Login method',
      phoneTab: 'Phone',
      nationalIdTab: 'National ID',
      phoneLabel: 'Phone number',
      nationalIdLabel: 'National ID',
      nationalIdPlaceholder: '14-digit National ID',
      phoneHint: 'Use the verified phone number linked to your PRENEURA account.',
      nationalIdHint:
        'Your National ID is only used to find your account. The OTP is sent to your registered phone.',
      checking: 'Checking…',
      continueOtp: 'Continue with OTP',
      or: 'or',
      continueGoogle: 'Continue with Google',
      securityNote:
        'PRENEURA never uses your National ID as a password. Staff and partner permissions are applied only after identity verification and are enforced again by the server for every protected action.',
      genericStartError: 'Check the login details and try again.',
      genericStartFailure: 'Unable to start login.',
      genericOtpNotice:
        'If the details match an active account, a one-time code will be sent to the registered phone.',
      invalidOtp: 'The one-time code is invalid or expired.',
      verifyFailure: 'Unable to verify the code.',
      otpLabel: 'One-time code',
      otpPlaceholder: '6-digit code',
      verifying: 'Verifying…',
      verifySignIn: 'Verify and sign in',
      anotherMethod: 'Use another login method',
    },
    accessPending: {
      identityVerified: 'Identity verified',
      title: 'Your secure account is ready.',
      body:
        'Access to developer projects, broker companies and operational roles is assigned separately so a verified identity never receives business permissions automatically.',
      foot: 'Identity verified • Access pending assignment',
      accessControl: 'Access control',
      waiting: 'Waiting for account access',
      waitingBody:
        'Your Google identity has been verified. A PRENEURA administrator or your organization manager must now assign the correct tenant, project and role before operational data becomes available.',
      notice: 'No buyer, project, financial or broker data is visible while the account remains unassigned.',
      returnSignIn: 'Return to sign in',
    },
    verifyAccount: {
      accountVerification: 'Account verification',
      verifiedTitle: 'Account verified',
      verifiedBody: 'Your phone identity is verified and your assigned workspace access is now active.',
      continueSignIn: 'Continue to sign in',
      secureEnrollment: 'Secure enrollment',
      title: 'Verify your account',
      body: 'Enter the same phone number used for your invitation and the six-digit code sent by PRENEURA.',
      phoneLabel: 'Phone number',
      codeLabel: 'Verification code',
      verifying: 'Verifying…',
      verify: 'Verify account',
      help: 'Codes expire for security. If your code expired, ask your PRENEURA administrator to resend verification.',
      error: 'Unable to verify this account.',
    },
  },
  ar: {
    login: {
      brandEyebrow: 'نظام تشغيل المبيعات العقارية',
      brandTitle: 'دخول آمن واحد لكل رحلة البيع العقاري.',
      brandBody:
        'يدخل المشترون والوسطاء وفرق المشروعات المصرح لهم إلى المنصة نفسها، مع الصلاحيات ونطاق المشروع ومستوى رؤية البيانات المحدد لكل حساب.',
      brandFoot: 'هوية محمية • نشاط مُدقَّق • صلاحيات محددة النطاق',
      secureAccess: 'دخول آمن',
      signIn: 'تسجيل الدخول إلى PRENEURA',
      enterOtp: 'أدخل رمز التحقق لمرة واحدة',
      intro: 'لا تحتاج إلى كلمة مرور. اختر طريقة التحقق الأنسب لحسابك.',
      otpIntro: 'تنتهي صلاحية الرمز خلال وقت قصير ولا يمكن استخدامه إلا مرة واحدة.',
      methodLabel: 'طريقة تسجيل الدخول',
      phoneTab: 'رقم الهاتف',
      nationalIdTab: 'الرقم القومي',
      phoneLabel: 'رقم الهاتف',
      nationalIdLabel: 'الرقم القومي',
      nationalIdPlaceholder: 'الرقم القومي المكوّن من 14 رقمًا',
      phoneHint: 'استخدم رقم الهاتف المُتحقق منه والمرتبط بحساب PRENEURA.',
      nationalIdHint:
        'يُستخدم الرقم القومي فقط للعثور على حسابك. يُرسل رمز التحقق إلى رقم الهاتف المسجل.',
      checking: 'جارٍ التحقق…',
      continueOtp: 'المتابعة برمز التحقق',
      or: 'أو',
      continueGoogle: 'المتابعة باستخدام Google',
      securityNote:
        'لا تستخدم PRENEURA الرقم القومي ككلمة مرور. تُطبَّق صلاحيات الموظفين والشركاء بعد التحقق من الهوية، ويعيد الخادم التحقق منها عند كل إجراء محمي.',
      genericStartError: 'راجع بيانات تسجيل الدخول وحاول مرة أخرى.',
      genericStartFailure: 'تعذر بدء تسجيل الدخول.',
      genericOtpNotice:
        'إذا كانت البيانات تطابق حسابًا نشطًا، فسيُرسل رمز تحقق لمرة واحدة إلى رقم الهاتف المسجل.',
      invalidOtp: 'رمز التحقق غير صحيح أو انتهت صلاحيته.',
      verifyFailure: 'تعذر التحقق من الرمز.',
      otpLabel: 'رمز التحقق لمرة واحدة',
      otpPlaceholder: 'رمز من 6 أرقام',
      verifying: 'جارٍ التحقق…',
      verifySignIn: 'التحقق وتسجيل الدخول',
      anotherMethod: 'استخدام طريقة دخول أخرى',
    },
    accessPending: {
      identityVerified: 'تم التحقق من الهوية',
      title: 'حسابك الآمن جاهز.',
      body:
        'تُمنح صلاحيات مشروعات المطورين وشركات الوساطة والأدوار التشغيلية بشكل منفصل، لذلك لا تحصل الهوية المُتحقق منها على صلاحيات العمل تلقائيًا.',
      foot: 'تم التحقق من الهوية • الصلاحيات في انتظار التعيين',
      accessControl: 'التحكم في الصلاحيات',
      waiting: 'في انتظار تعيين صلاحيات الحساب',
      waitingBody:
        'تم التحقق من هويتك عبر Google. يجب الآن أن يعيّن مسؤول PRENEURA أو مدير مؤسستك العميل والمشروع والدور المناسب قبل إتاحة البيانات التشغيلية.',
      notice: 'لن تظهر بيانات المشترين أو المشروعات أو البيانات المالية أو بيانات الوسطاء قبل تعيين الصلاحيات.',
      returnSignIn: 'العودة إلى تسجيل الدخول',
    },
    verifyAccount: {
      accountVerification: 'التحقق من الحساب',
      verifiedTitle: 'تم التحقق من الحساب',
      verifiedBody: 'تم التحقق من ملكية رقم هاتفك، وأصبحت صلاحيات مساحة العمل المعيّنة لحسابك نشطة.',
      continueSignIn: 'المتابعة إلى تسجيل الدخول',
      secureEnrollment: 'تفعيل آمن للحساب',
      title: 'تحقق من حسابك',
      body: 'أدخل رقم الهاتف نفسه المستخدم في الدعوة والرمز المكوّن من ستة أرقام الذي أرسلته PRENEURA.',
      phoneLabel: 'رقم الهاتف',
      codeLabel: 'رمز التحقق',
      verifying: 'جارٍ التحقق…',
      verify: 'التحقق من الحساب',
      help: 'تنتهي صلاحية الرموز لأسباب أمنية. إذا انتهت صلاحية الرمز، اطلب من مسؤول PRENEURA إعادة إرسال رمز التحقق.',
      error: 'تعذر التحقق من هذا الحساب.',
    },
  },
};
