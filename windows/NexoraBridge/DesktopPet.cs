using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace NexoraBridge;

internal sealed record DesktopChatMessage(string Role, string Content);

internal sealed record DesktopChatResponse(
    string Text,
    DesktopChatEmotion? Emotion,
    DesktopChatAction[]? Actions);

internal sealed record DesktopChatEmotion(string? Mood);
internal sealed record DesktopChatAction(string? Target, string? Action);

internal sealed class DesktopPetPreferences
{
    public int Version { get; set; } = 1;
    public int? X { get; set; }
    public int? Y { get; set; }
    public int Width { get; set; } = 340;
    public bool Visible { get; set; } = true;
    public bool ClickThrough { get; set; }
    public string Starter { get; set; } = "cute";
    public string Stage { get; set; } = "seed";
    public string Name { get; set; } = "露莫";
    public List<DesktopChatMessage> ChatHistory { get; set; } = [];
}

internal static class DesktopPetPreferenceStore
{
    private static readonly string DirectoryPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NEXORA CORE");
    private static readonly string FilePath = Path.Combine(DirectoryPath, "desktop-pet.json");

    internal static DesktopPetPreferences Load()
    {
        try
        {
            DesktopPetPreferences? value = JsonSerializer.Deserialize<DesktopPetPreferences>(
                File.ReadAllBytes(FilePath),
                JsonDefaults.Options);
            if (value?.Version != 1) return new DesktopPetPreferences();
            value.Width = Math.Clamp(value.Width, 220, 560);
            value.Starter = DesktopPetController.Starters.Contains(value.Starter) ? value.Starter : "cute";
            value.Stage = DesktopPetController.Stages.Contains(value.Stage) ? value.Stage : "seed";
            value.Name = DesktopPetController.NormalizeName(value.Name, value.Starter);
            value.ChatHistory = value.ChatHistory
                .Where(message => message.Role is "user" or "assistant" && !string.IsNullOrWhiteSpace(message.Content))
                .TakeLast(12)
                .ToList();
            return value;
        }
        catch
        {
            return new DesktopPetPreferences();
        }
    }

    internal static void Save(DesktopPetPreferences value)
    {
        try
        {
            Directory.CreateDirectory(DirectoryPath);
            string temporaryPath = FilePath + ".tmp";
            File.WriteAllBytes(temporaryPath, JsonSerializer.SerializeToUtf8Bytes(value, JsonDefaults.Options));
            File.Move(temporaryPath, FilePath, true);
        }
        catch
        {
            // A read-only profile should not stop the pet from running.
        }
    }
}

internal static class DesktopPetRuntime
{
    internal static string Root => Path.Combine(AppContext.BaseDirectory, "Runtime");

    internal static void ValidateAssets()
    {
        string[] requiredFiles =
        [
            "desktop-pet/index.html",
            "desktop-pet/style.css",
            "desktop-pet/app.mjs",
            "shared/creature-3d-viewer.mjs",
            "shared/creature-3d-data.mjs",
            "desktop-wallpaper/vendor/three.module.js",
            "desktop-wallpaper/vendor/GLTFLoader.js",
            "desktop-wallpaper/vendor/BufferGeometryUtils.js",
            "desktop-wallpaper/vendor/meshopt_decoder.module.js",
            "NEXORA_3D_CREATURES/CUTE_LUMO/model/rigged.glb",
            "NEXORA_3D_CREATURES/COOL_VEYR/model/rigged.glb",
            "NEXORA_3D_CREATURES/BEAUTIFUL_AERA/model/rigged.glb"
        ];
        string? missing = requiredFiles.FirstOrDefault(path => !File.Exists(Path.Combine(Root, path)));
        if (missing is not null)
        {
            throw new FileNotFoundException($"Desktop pet runtime is incomplete: {missing}");
        }
    }
}

internal sealed class DesktopPetForm : Form
{
    private const int WsExToolWindow = 0x00000080;
    private const int WsExTransparent = 0x00000020;
    private const int GwlExStyle = -20;
    private const double AspectRatio = 340d / 430d;

    private readonly WebView2 webView = new();
    private readonly DesktopPetPreferences preferences;
    private Task? initialization;
    private Point dragPointerOrigin;
    private Point dragWindowOrigin;
    private bool dragging;
    private bool allowClose;

    internal event Action<JsonElement>? NativeMessage;
    internal event Action<string>? RuntimeError;
    internal bool IsRuntimeReady => webView.CoreWebView2 is not null;

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams parameters = base.CreateParams;
            parameters.ExStyle |= WsExToolWindow;
            return parameters;
        }
    }

    internal DesktopPetForm(DesktopPetPreferences preferences)
    {
        this.preferences = preferences;
        Text = "NEXORA 3D Desktop Pet";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = false;
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.Fuchsia;
        TransparencyKey = Color.Fuchsia;
        AllowTransparency = true;
        StartPosition = FormStartPosition.Manual;

        int width = Math.Clamp(preferences.Width, 220, 560);
        ClientSize = new Size(width, HeightForWidth(width));
        Location = ResolveInitialLocation(ClientSize, preferences.X, preferences.Y);

        webView.Dock = DockStyle.Fill;
        webView.Margin = Padding.Empty;
        webView.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(webView);

        FormClosing += (_, eventArguments) =>
        {
            if (allowClose) return;
            eventArguments.Cancel = true;
            Hide();
            preferences.Visible = false;
            SaveFrame();
        };
    }

    internal Task EnsureInitializedAsync()
    {
        initialization ??= InitializeAsync();
        return initialization;
    }

    internal void ShowPet()
    {
        if (!Visible) Show();
        BringToFront();
        preferences.Visible = true;
        DesktopPetPreferenceStore.Save(preferences);
        _ = EnsureInitializedAsync();
    }

    internal void HidePet()
    {
        Hide();
        preferences.Visible = false;
        DesktopPetPreferenceStore.Save(preferences);
    }

    internal void ResetPosition()
    {
        Rectangle workingArea = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1440, 900);
        Location = new Point(workingArea.Right - Width - 24, workingArea.Bottom - Height - 24);
        SaveFrame();
        ShowPet();
    }

    internal void ResetSize()
    {
        ResizeAtCursor(340, new Point(Left + Width / 2, Top + Height / 2));
        SaveFrame();
        ShowPet();
    }

    internal void MoveFromNativeDrag(Point pointer, Point pointerOrigin, Point windowOrigin)
    {
        Rectangle area = Screen.FromPoint(pointer).WorkingArea;
        int x = Math.Clamp(windowOrigin.X + pointer.X - pointerOrigin.X, area.Left, area.Right - Width);
        int y = Math.Clamp(windowOrigin.Y + pointer.Y - pointerOrigin.Y, area.Top, area.Bottom - Height);
        Location = new Point(x, y);
    }

    internal void ResizeFromNativeWheel(int delta, Point anchor)
    {
        double factor = Math.Exp(-delta * 0.0016);
        ResizeAtCursor((int)Math.Round(Width * Math.Clamp(factor, 0.82, 1.22)), anchor);
        SaveFrame();
    }

    internal void SaveNativeFrame() => SaveFrame();

    internal void SetClickThrough(bool enabled)
    {
        preferences.ClickThrough = enabled;
        if (IsHandleCreated)
        {
            nint style = GetWindowLongPtr(Handle, GwlExStyle);
            nint nextStyle = enabled ? style | WsExTransparent : style & ~WsExTransparent;
            if (nextStyle != style)
            {
                SetWindowLongPtr(Handle, GwlExStyle, nextStyle);
                SetWindowPos(
                    Handle,
                    nint.Zero,
                    0,
                    0,
                    0,
                    0,
                    SetWindowPositionFlags.NoMove |
                    SetWindowPositionFlags.NoSize |
                    SetWindowPositionFlags.NoZOrder |
                    SetWindowPositionFlags.NoActivate |
                    SetWindowPositionFlags.FrameChanged);
            }
        }
        DesktopPetPreferenceStore.Save(preferences);
    }

    internal void ActivateConversation()
    {
        SetClickThrough(false);
        ShowPet();
        Activate();
        webView.Focus();
        BeginInvoke(new Action(async () =>
        {
            if (webView.CoreWebView2 is null) return;
            await webView.ExecuteScriptAsync("document.querySelector('#conversation-input')?.focus()");
        }));
    }

    internal async Task ExecuteAsync(string function, object payload)
    {
        if (webView.CoreWebView2 is null) return;
        string json = JsonSerializer.Serialize(payload, JsonDefaults.Options);
        await webView.ExecuteScriptAsync($"window.NexoraDesktopPet?.{function}({json});");
    }

    internal async Task<int> SampleOpaquePixelsAsync()
    {
        if (webView.CoreWebView2 is null) return 0;
        string json = await webView.ExecuteScriptAsync("window.__NEXORA_DESKTOP_PET_QA__?.sampleModel()");
        using JsonDocument document = JsonDocument.Parse(json);
        return document.RootElement.TryGetProperty("opaque", out JsonElement opaque)
            ? opaque.GetInt32()
            : 0;
    }

    internal async Task<bool> IsConversationInputFocusedAsync()
    {
        if (webView.CoreWebView2 is null) return false;
        string json = await webView.ExecuteScriptAsync("document.activeElement?.id === 'conversation-input'");
        return string.Equals(json, "true", StringComparison.OrdinalIgnoreCase);
    }

    internal bool IsClickThroughStyleEnabled =>
        IsHandleCreated && (GetWindowLongPtr(Handle, GwlExStyle) & (nint)WsExTransparent) != nint.Zero;

    internal Task DispatchMouseClickAsync(int count)
    {
        return DispatchMouseClickAsync(ClientSize.Width / 2, ClientSize.Height / 2, count);
    }

    private async Task DispatchMouseClickAsync(int x, int y, int count)
    {
        if (webView.CoreWebView2 is null) throw new InvalidOperationException("Desktop pet WebView2 is not ready.");
        await webView.CoreWebView2.CallDevToolsProtocolMethodAsync(
            "Input.dispatchMouseEvent",
            JsonSerializer.Serialize(new { type = "mouseMoved", x, y }));
        for (int index = 1; index <= count; index += 1)
        {
            await webView.CoreWebView2.CallDevToolsProtocolMethodAsync(
                "Input.dispatchMouseEvent",
                JsonSerializer.Serialize(new { type = "mousePressed", x, y, button = "left", clickCount = index }));
            await webView.CoreWebView2.CallDevToolsProtocolMethodAsync(
                "Input.dispatchMouseEvent",
                JsonSerializer.Serialize(new { type = "mouseReleased", x, y, button = "left", clickCount = index }));
            if (index < count) await Task.Delay(80);
        }
    }

    internal async Task TypeConversationMessageAsync(string text)
    {
        if (webView.CoreWebView2 is null) throw new InvalidOperationException("Desktop pet WebView2 is not ready.");
        await webView.CoreWebView2.CallDevToolsProtocolMethodAsync(
            "Input.insertText",
            JsonSerializer.Serialize(new { text }));
        string value = await webView.ExecuteScriptAsync("document.querySelector('#conversation-input')?.value || ''");
        if (JsonSerializer.Deserialize<string>(value) != text)
        {
            throw new InvalidOperationException("Desktop pet conversation input did not accept the test message.");
        }
        string submitted = await webView.ExecuteScriptAsync(
            "(() => { const input = document.querySelector('#conversation-input'); " +
            "if (!input?.form) return false; input.form.requestSubmit(); return true; })()");
        if (!string.Equals(submitted, "true", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Desktop pet conversation form could not be submitted.");
        }
    }

    internal void ClosePermanently()
    {
        allowClose = true;
        webView.Dispose();
        Close();
        Dispose();
    }

    private async Task InitializeAsync()
    {
        try
        {
            DesktopPetRuntime.ValidateAssets();
            if (!IsHandleCreated) CreateControl();
            if (!webView.IsHandleCreated) webView.CreateControl();
            string userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "NEXORA CORE",
                "WebView2");
            Directory.CreateDirectory(userData);
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await webView.EnsureCoreWebView2Async(environment);
            CoreWebView2 core = webView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.SetVirtualHostNameToFolderMapping(
                "nexora.local",
                DesktopPetRuntime.Root,
                CoreWebView2HostResourceAccessKind.DenyCors);
            core.WebMessageReceived += (_, eventArguments) => ReceiveMessage(eventArguments.WebMessageAsJson);
            core.NavigationStarting += (_, eventArguments) =>
            {
                if (!eventArguments.Uri.StartsWith("https://nexora.local/", StringComparison.OrdinalIgnoreCase))
                {
                    eventArguments.Cancel = true;
                }
            };
            webView.Source = new Uri("https://nexora.local/desktop-pet/index.html?platform=windows&release=windows-pet-v1");
            SetClickThrough(preferences.ClickThrough);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            RuntimeError?.Invoke("这台电脑缺少 Microsoft Edge WebView2 Runtime，请安装后重新打开 NEXORA Bridge。");
        }
        catch (Exception error)
        {
            RuntimeError?.Invoke($"桌面宠物启动失败：{error.Message}");
        }
    }

    private void ReceiveMessage(string json)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(json);
            JsonElement message = document.RootElement.Clone();
            if (!message.TryGetProperty("type", out JsonElement typeElement)) return;
            string type = typeElement.GetString() ?? string.Empty;
            switch (type)
            {
                case "pointer-down":
                    if (preferences.ClickThrough) return;
                    dragging = false;
                    dragPointerOrigin = Cursor.Position;
                    dragWindowOrigin = Location;
                    break;
                case "pointer-move":
                    if (preferences.ClickThrough) return;
                    Point pointer = Cursor.Position;
                    if (Math.Abs(pointer.X - dragPointerOrigin.X) + Math.Abs(pointer.Y - dragPointerOrigin.Y) < 5) return;
                    dragging = true;
                    Rectangle area = Screen.FromPoint(pointer).WorkingArea;
                    int x = Math.Clamp(dragWindowOrigin.X + pointer.X - dragPointerOrigin.X, area.Left, area.Right - Width);
                    int y = Math.Clamp(dragWindowOrigin.Y + pointer.Y - dragPointerOrigin.Y, area.Top, area.Bottom - Height);
                    Location = new Point(x, y);
                    break;
                case "pointer-up":
                    if (dragging) SaveFrame();
                    dragging = false;
                    break;
                case "resize":
                    if (preferences.ClickThrough) return;
                    double delta = message.TryGetProperty("deltaY", out JsonElement deltaElement)
                        ? deltaElement.GetDouble()
                        : 0;
                    double factor = Math.Exp(-delta * 0.0016);
                    ResizeAtCursor((int)Math.Round(Width * Math.Clamp(factor, 0.82, 1.22)), Cursor.Position);
                    SaveFrame();
                    break;
                default:
                    NativeMessage?.Invoke(message);
                    break;
            }
        }
        catch (JsonException)
        {
            // Ignore malformed messages from the embedded page.
        }
    }

    private void ResizeAtCursor(int proposedWidth, Point anchor)
    {
        Rectangle area = Screen.FromPoint(anchor).WorkingArea;
        int maximumWidth = Math.Min(560, Math.Max(220, area.Width - 16));
        int width = Math.Clamp(proposedWidth, 220, maximumWidth);
        int height = HeightForWidth(width);
        double anchorX = Math.Clamp((anchor.X - Left) / (double)Math.Max(1, Width), 0, 1);
        double anchorY = Math.Clamp((anchor.Y - Top) / (double)Math.Max(1, Height), 0, 1);
        int x = (int)Math.Round(anchor.X - width * anchorX);
        int y = (int)Math.Round(anchor.Y - height * anchorY);
        x = Math.Clamp(x, area.Left, area.Right - width);
        y = Math.Clamp(y, area.Top, area.Bottom - height);
        Bounds = new Rectangle(x, y, width, height);
    }

    private void SaveFrame()
    {
        preferences.X = Left;
        preferences.Y = Top;
        preferences.Width = Width;
        DesktopPetPreferenceStore.Save(preferences);
    }

    private static int HeightForWidth(int width) => (int)Math.Round(width / AspectRatio);

    private static Point ResolveInitialLocation(Size size, int? savedX, int? savedY)
    {
        if (savedX.HasValue && savedY.HasValue)
        {
            Rectangle saved = new(savedX.Value, savedY.Value, size.Width, size.Height);
            Screen? target = Screen.AllScreens.FirstOrDefault(screen => screen.WorkingArea.IntersectsWith(saved));
            if (target is not null)
            {
                Rectangle area = target.WorkingArea;
                return new Point(
                    Math.Clamp(saved.Left, area.Left, area.Right - size.Width),
                    Math.Clamp(saved.Top, area.Top, area.Bottom - size.Height));
            }
        }
        Rectangle primary = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1440, 900);
        return new Point(primary.Right - size.Width - 24, primary.Bottom - size.Height - 24);
    }

    private static nint GetWindowLongPtr(nint window, int index) => IntPtr.Size == 8
        ? GetWindowLongPtr64(window, index)
        : new nint(GetWindowLong32(window, index));

    private static nint SetWindowLongPtr(nint window, int index, nint value) => IntPtr.Size == 8
        ? SetWindowLongPtr64(window, index, value)
        : new nint(SetWindowLong32(window, index, value.ToInt32()));

    [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
    private static extern int GetWindowLong32(nint window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
    private static extern nint GetWindowLongPtr64(nint window, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
    private static extern int SetWindowLong32(nint window, int index, int value);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
    private static extern nint SetWindowLongPtr64(nint window, int index, nint value);

    [Flags]
    private enum SetWindowPositionFlags : uint
    {
        NoSize = 0x0001,
        NoMove = 0x0002,
        NoZOrder = 0x0004,
        NoActivate = 0x0010,
        FrameChanged = 0x0020
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        nint window,
        nint insertAfter,
        int x,
        int y,
        int width,
        int height,
        SetWindowPositionFlags flags);
}

internal readonly record struct DesktopPetMouseInput(int Message, Point ScreenPoint, int WheelDelta);

internal sealed class DesktopPetMouseHook : IDisposable
{
    internal const int MouseMove = 0x0200;
    internal const int LeftButtonDown = 0x0201;
    internal const int LeftButtonUp = 0x0202;
    internal const int MouseWheel = 0x020A;
    private const int LowLevelMouseHook = 14;

    private readonly HookCallback callback;
    private readonly Func<DesktopPetMouseInput, bool> inputHandler;
    private nint handle;

    internal DesktopPetMouseHook(Func<DesktopPetMouseInput, bool> inputHandler)
    {
        this.inputHandler = inputHandler;
        callback = Receive;
        handle = SetWindowsHookEx(LowLevelMouseHook, callback, GetModuleHandle(null), 0);
        if (handle == nint.Zero)
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Unable to install desktop pet mouse hook.");
        }
    }

    private nint Receive(int code, nint message, nint data)
    {
        if (code >= 0)
        {
            MouseHookData input = Marshal.PtrToStructure<MouseHookData>(data);
            int messageId = message.ToInt32();
            int wheelDelta = messageId == MouseWheel ? (short)(input.MouseData >> 16) : 0;
            if (inputHandler(new DesktopPetMouseInput(messageId, new Point(input.Point.X, input.Point.Y), wheelDelta)))
            {
                return new nint(1);
            }
        }
        return CallNextHookEx(handle, code, message, data);
    }

    public void Dispose()
    {
        if (handle == nint.Zero) return;
        UnhookWindowsHookEx(handle);
        handle = nint.Zero;
    }

    private delegate nint HookCallback(int code, nint message, nint data);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        internal int X;
        internal int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseHookData
    {
        internal NativePoint Point;
        internal uint MouseData;
        internal uint Flags;
        internal uint Time;
        internal UIntPtr ExtraInfo;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern nint SetWindowsHookEx(int hook, HookCallback callback, nint module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(nint hook);

    [DllImport("user32.dll")]
    private static extern nint CallNextHookEx(nint hook, int code, nint message, nint data);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern nint GetModuleHandle(string? moduleName);
}

internal sealed class DesktopPetConversationForm : Form
{
    private readonly Label status = new();
    private readonly TextBox input = new();
    private readonly Button send = new();
    private bool allowClose;

    internal event Action<string>? MessageSubmitted;
    internal event Action? ConversationClosed;

    internal DesktopPetConversationForm()
    {
        Text = "NEXORA 对话";
        ClientSize = new Size(410, 150);
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        ShowInTaskbar = false;
        TopMost = true;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Microsoft YaHei UI", 10f);
        BackColor = Color.FromArgb(24, 27, 30);
        ForeColor = Color.WhiteSmoke;

        status.Dock = DockStyle.Fill;
        status.Padding = new Padding(14, 12, 14, 8);
        status.AutoEllipsis = true;
        status.ForeColor = Color.WhiteSmoke;
        status.Text = "我在，想聊什么？";

        input.Dock = DockStyle.Fill;
        input.MaxLength = 160;
        input.BorderStyle = BorderStyle.FixedSingle;
        input.BackColor = Color.FromArgb(245, 247, 248);
        input.ForeColor = Color.FromArgb(20, 23, 26);
        input.Margin = new Padding(14, 8, 8, 14);

        send.Text = "发送";
        send.AutoSize = false;
        send.Width = 76;
        send.Dock = DockStyle.Fill;
        send.FlatStyle = FlatStyle.System;
        send.Margin = new Padding(0, 8, 14, 14);
        send.Click += (_, _) => Submit();

        TableLayoutPanel layout = new()
        {
            Dock = DockStyle.Fill,
            BackColor = BackColor,
            ColumnCount = 2,
            RowCount = 2,
            Padding = Padding.Empty
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 98));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
        layout.Controls.Add(status, 0, 0);
        layout.SetColumnSpan(status, 2);
        layout.Controls.Add(input, 0, 1);
        layout.Controls.Add(send, 1, 1);
        Controls.Add(layout);

        AcceptButton = send;
        input.KeyDown += (_, eventArguments) =>
        {
            if (eventArguments.KeyCode != Keys.Escape) return;
            eventArguments.SuppressKeyPress = true;
            HideConversation();
        };
        FormClosing += (_, eventArguments) =>
        {
            if (allowClose) return;
            eventArguments.Cancel = true;
            HideConversation();
        };
    }

    internal void ShowConversation(Rectangle petBounds, string petName, string initialStatus)
    {
        Text = $"与 {petName} 对话";
        status.Text = initialStatus;
        SetBusy(false);
        Rectangle area = Screen.FromRectangle(petBounds).WorkingArea;
        int x = Math.Clamp(petBounds.Left + (petBounds.Width - Width) / 2, area.Left + 8, area.Right - Width - 8);
        int preferredY = petBounds.Top - Height - 12;
        int y = preferredY >= area.Top + 8 ? preferredY : Math.Min(area.Bottom - Height - 8, petBounds.Bottom + 12);
        Location = new Point(x, Math.Max(area.Top + 8, y));
        if (!Visible) Show();
        BringToFront();
        Activate();
        input.Focus();
    }

    internal void SetThinking(string petName)
    {
        status.Text = $"{petName} 正在理解……";
        SetBusy(true);
    }

    internal void SetReply(string text)
    {
        status.Text = text;
        SetBusy(false);
        Activate();
        input.Focus();
    }

    internal void SetError(string text)
    {
        status.Text = text;
        SetBusy(false);
        Activate();
        input.Focus();
    }

    internal void HideConversation()
    {
        if (!Visible) return;
        Hide();
        ConversationClosed?.Invoke();
    }

    internal void SubmitForSelfTest(string text)
    {
        input.Text = text;
        Submit();
    }

    internal void ClosePermanently()
    {
        allowClose = true;
        Close();
        Dispose();
    }

    private void Submit()
    {
        string text = string.Join(' ', input.Text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (string.IsNullOrWhiteSpace(text) || !input.Enabled) return;
        input.Clear();
        MessageSubmitted?.Invoke(text.Length <= 160 ? text : text[..160]);
    }

    private void SetBusy(bool busy)
    {
        input.Enabled = !busy;
        send.Enabled = !busy;
    }
}

internal sealed class DesktopPetController : IDisposable
{
    internal static readonly HashSet<string> Starters = ["cute", "cool", "beautiful"];
    internal static readonly HashSet<string> Stages = ["seed", "young", "resonance"];
    internal static readonly HashSet<string> Actions = ["idle", "listening", "nod", "affection", "wave", "speaking", "walk", "run"];

    private readonly DesktopPetPreferences preferences = DesktopPetPreferenceStore.Load();
    private readonly DesktopPetForm form;
    private readonly DesktopPetConversationForm conversationForm = new();
    private readonly System.Windows.Forms.Timer clickTimer = new();
    private readonly HttpClient client;
    private DesktopPetMouseHook? mouseHook;
    private BridgeConfiguration? bridgeConfiguration;
    private CancellationTokenSource? chatCancellation;
    private CancellationTokenSource? voiceCancellation;
    private Point mousePointerOrigin;
    private Point mouseWindowOrigin;
    private Point pendingClickPoint;
    private bool nativeMouseDown;
    private bool nativeDragging;
    private int clickActionIndex;
    private bool conversationOpen;
    private bool conversationBusy;
    private bool modelReady;

    internal event Action<string>? RuntimeError;
    internal bool IsVisible => form.Visible;
    internal bool IsClickThrough => preferences.ClickThrough;
    internal string Starter => preferences.Starter;
    internal string Stage => preferences.Stage;
    internal string PetName => preferences.Name;

    internal DesktopPetController()
    {
        form = new DesktopPetForm(preferences);
        form.NativeMessage += HandleNativeMessage;
        form.RuntimeError += message => RuntimeError?.Invoke(message);
        conversationForm.MessageSubmitted += text => _ = SendChatAsync(text);
        conversationForm.ConversationClosed += () =>
        {
            conversationOpen = false;
            CancelConversation();
        };
        clickTimer.Interval = Math.Clamp(SystemInformation.DoubleClickTime, 180, 500);
        clickTimer.Tick += (_, _) =>
        {
            clickTimer.Stop();
            string[] actions = ["wave", "nod", "affection"];
            Play(actions[clickActionIndex % actions.Length]);
            clickActionIndex += 1;
        };
        client = new HttpClient(new SocketsHttpHandler
        {
            AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate,
            UseCookies = false
        })
        {
            Timeout = TimeSpan.FromSeconds(24)
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("NEXORA-Bridge-Windows/0.2");
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    internal void Start()
    {
        // Click-through is a temporary mode. Reset it on launch so an old preference cannot lock out interaction.
        form.SetClickThrough(false);
        _ = form.EnsureInitializedAsync();
        if (preferences.Visible) form.ShowPet();
        try
        {
            mouseHook ??= new DesktopPetMouseHook(HandleNativeMouseInput);
        }
        catch (Exception error)
        {
            RuntimeError?.Invoke($"桌面宠物鼠标交互启动失败：{error.Message}");
        }
    }

    internal void SetBridgeConfiguration(BridgeConfiguration? configuration)
    {
        bridgeConfiguration = configuration;
        if (configuration is null && conversationOpen)
        {
            CancelConversation();
            conversationForm.SetError("请先从系统托盘配对电脑");
        }
    }

    internal void ToggleVisibility()
    {
        if (form.Visible)
        {
            conversationForm.HideConversation();
            form.HidePet();
        }
        else form.ShowPet();
    }

    internal void OpenConversation()
    {
        SetClickThrough(false);
        form.ShowPet();
        conversationOpen = true;
        conversationForm.ShowConversation(
            form.Bounds,
            preferences.Name,
            bridgeConfiguration is null ? "请先从系统托盘配对电脑" : "我在，想聊什么？");
    }

    internal void SetStarter(string value)
    {
        if (!Starters.Contains(value)) return;
        bool usesDefaultName = preferences.Name == DefaultName(preferences.Starter);
        preferences.Starter = value;
        if (usesDefaultName) preferences.Name = DefaultName(value);
        SaveAndConfigure();
    }

    internal void SetStage(string value)
    {
        if (!Stages.Contains(value)) return;
        preferences.Stage = value;
        SaveAndConfigure();
    }

    internal void SetName(string value)
    {
        preferences.Name = NormalizeName(value, preferences.Starter);
        SaveAndConfigure();
    }

    internal void Play(string action)
    {
        if (!Actions.Contains(action)) return;
        form.ShowPet();
        _ = form.ExecuteAsync("play", new { action });
    }

    internal void SetClickThrough(bool enabled)
    {
        form.SetClickThrough(enabled);
        if (enabled) conversationForm.HideConversation();
    }

    internal void ResetPosition() => form.ResetPosition();
    internal void ResetSize() => form.ResetSize();

    private bool HandleNativeMouseInput(DesktopPetMouseInput input)
    {
        if (!form.Visible || preferences.ClickThrough) return false;
        if (conversationForm.Visible && conversationForm.Bounds.Contains(input.ScreenPoint)) return false;

        bool overPet = form.Bounds.Contains(input.ScreenPoint);
        switch (input.Message)
        {
            case DesktopPetMouseHook.LeftButtonDown when overPet:
                nativeMouseDown = true;
                nativeDragging = false;
                mousePointerOrigin = input.ScreenPoint;
                mouseWindowOrigin = form.Location;
                return true;
            case DesktopPetMouseHook.MouseMove when nativeMouseDown:
                if (!nativeDragging &&
                    Math.Abs(input.ScreenPoint.X - mousePointerOrigin.X) +
                    Math.Abs(input.ScreenPoint.Y - mousePointerOrigin.Y) >= 5)
                {
                    nativeDragging = true;
                    clickTimer.Stop();
                }
                if (nativeDragging)
                {
                    form.MoveFromNativeDrag(input.ScreenPoint, mousePointerOrigin, mouseWindowOrigin);
                }
                return true;
            case DesktopPetMouseHook.LeftButtonUp when nativeMouseDown:
                nativeMouseDown = false;
                if (nativeDragging)
                {
                    nativeDragging = false;
                    form.SaveNativeFrame();
                }
                else
                {
                    RegisterNativeClick(input.ScreenPoint);
                }
                return true;
            case DesktopPetMouseHook.MouseWheel when overPet:
                form.ResizeFromNativeWheel(-input.WheelDelta, input.ScreenPoint);
                return true;
            default:
                return false;
        }
    }

    private void RegisterNativeClick(Point point)
    {
        Size tolerance = SystemInformation.DoubleClickSize;
        bool isDoubleClick = clickTimer.Enabled &&
            Math.Abs(point.X - pendingClickPoint.X) <= tolerance.Width &&
            Math.Abs(point.Y - pendingClickPoint.Y) <= tolerance.Height;
        if (isDoubleClick)
        {
            clickTimer.Stop();
            OpenConversation();
            return;
        }
        pendingClickPoint = point;
        clickTimer.Stop();
        clickTimer.Start();
    }

    internal static string NormalizeName(string? value, string starter)
    {
        string cleaned = string.Join(' ', (value ?? string.Empty)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (string.IsNullOrWhiteSpace(cleaned)) return DefaultName(starter);
        return cleaned.Length <= 12 ? cleaned : cleaned[..12];
    }

    private static string DefaultName(string starter) => starter switch
    {
        "cool" => "维尔",
        "beautiful" => "艾拉",
        _ => "露莫"
    };

    private void HandleNativeMessage(JsonElement message)
    {
        string type = message.TryGetProperty("type", out JsonElement typeElement)
            ? typeElement.GetString() ?? string.Empty
            : string.Empty;
        switch (type)
        {
            case "ready":
                modelReady = true;
                ApplyConfiguration();
                break;
            case "model-error":
                string detail = message.TryGetProperty("message", out JsonElement errorElement)
                    ? errorElement.GetString() ?? "模型加载失败"
                    : "模型加载失败";
                RuntimeError?.Invoke($"桌面宠物模型加载失败：{detail}");
                break;
            case "conversation-state":
                conversationOpen = message.TryGetProperty("open", out JsonElement openElement) && openElement.GetBoolean();
                if (conversationOpen) form.ActivateConversation();
                else CancelConversation();
                break;
            case "chat-submit":
                string text = message.TryGetProperty("text", out JsonElement textElement)
                    ? textElement.GetString() ?? string.Empty
                    : string.Empty;
                _ = SendChatAsync(text);
                break;
        }
    }

    private void SaveAndConfigure()
    {
        DesktopPetPreferenceStore.Save(preferences);
        ApplyConfiguration();
        form.ShowPet();
    }

    private void ApplyConfiguration()
    {
        if (!modelReady) return;
        _ = form.ExecuteAsync("configure", new
        {
            starter = preferences.Starter,
            stage = preferences.Stage,
            name = preferences.Name,
            action = "idle"
        });
    }

    private async Task SendChatAsync(string rawText)
    {
        string text = string.Join(' ', rawText.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (conversationBusy || string.IsNullOrWhiteSpace(text)) return;
        if (bridgeConfiguration is null)
        {
            conversationForm.SetError("请先从系统托盘配对电脑");
            await form.ExecuteAsync("setConversationState", new { phase = "error", status = "请先从系统托盘配对电脑" });
            return;
        }

        conversationBusy = true;
        conversationForm.SetThinking(preferences.Name);
        await form.ExecuteAsync("setConversationState", new { phase = "thinking", status = $"{preferences.Name} 正在理解……" });
        chatCancellation?.Cancel();
        chatCancellation?.Dispose();
        chatCancellation = new CancellationTokenSource(TimeSpan.FromSeconds(24));
        CancellationToken token = chatCancellation.Token;
        string userText = text.Length <= 160 ? text : text[..160];
        DesktopChatMessage[] requestHistory = preferences.ChatHistory.TakeLast(10).ToArray();
        AppendHistory(new DesktopChatMessage("user", userText));

        Dictionary<string, object?> body = new()
        {
            ["text"] = userText,
            ["persona"] = $"creature:{preferences.Starter}",
            ["persona_short"] = $"creature:{preferences.Starter}",
            ["relationship"] = "companion",
            ["scene"] = "daily",
            ["history"] = requestHistory.Select(message => new { role = message.Role, content = message.Content }).ToArray(),
            ["soulmate"] = new
            {
                name = preferences.Name,
                starter = preferences.Starter,
                starterId = preferences.Starter,
                species = SpeciesName,
                stage = preferences.Stage,
                daysTogether = 1,
                bond = Math.Min(240, preferences.ChatHistory.Count * 3),
                interactions = preferences.ChatHistory.Count,
                traits = new { warmth = 72, curiosity = 68, steadiness = 66, courage = 58, independence = 55 },
                memories = Array.Empty<object>()
            },
            ["voice_context"] = new
            {
                persona = $"creature:{preferences.Starter}",
                archetype = VoiceArchetype,
                starter = preferences.Starter
            },
            ["client_release"] = "desktop-pet-windows-v1"
        };

        try
        {
            using HttpRequestMessage request = CreateBridgeRequest(bridgeConfiguration, "/api/device-bridge/chat", JsonContent.Create(body));
            using HttpResponseMessage response = await client.SendAsync(request, token);
            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                await FinishChatWithErrorAsync("电脑配对已失效，请重新配对");
                return;
            }
            response.EnsureSuccessStatusCode();
            DesktopChatResponse? reply = await response.Content.ReadFromJsonAsync<DesktopChatResponse>(JsonDefaults.Options, token);
            if (reply is null || string.IsNullOrWhiteSpace(reply.Text))
            {
                await FinishChatWithErrorAsync("真实对话暂时不可用，请稍后重试");
                return;
            }

            string replyText = reply.Text.Length <= 300 ? reply.Text : reply.Text[..300];
            AppendHistory(new DesktopChatMessage("assistant", replyText));
            string requestedAction = reply.Actions?.FirstOrDefault(action => action.Target == "companion")?.Action ?? "voice";
            string action = requestedAction switch
            {
                "heart" => "affection",
                "nod" or "wave" or "walk" or "run" => requestedAction,
                _ => "speaking"
            };
            conversationBusy = false;
            conversationForm.SetReply(replyText);
            await form.ExecuteAsync("receiveReply", new { text = replyText, action });
            _ = RequestVoiceAsync(replyText, reply.Emotion?.Mood ?? "calm", bridgeConfiguration);
        }
        catch (OperationCanceledException)
        {
            conversationBusy = false;
        }
        catch
        {
            await FinishChatWithErrorAsync("真实对话暂时不可用，请稍后重试");
        }
    }

    private async Task RequestVoiceAsync(string text, string mood, BridgeConfiguration configuration)
    {
        voiceCancellation?.Cancel();
        voiceCancellation?.Dispose();
        voiceCancellation = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        Dictionary<string, object?> body = new()
        {
            ["text"] = text,
            ["persona"] = $"creature:{preferences.Starter}",
            ["relationship"] = "companion",
            ["mood"] = mood,
            ["archetype"] = VoiceArchetype,
            ["starter"] = preferences.Starter
        };
        try
        {
            using HttpRequestMessage request = CreateBridgeRequest(configuration, "/api/device-bridge/voice", JsonContent.Create(body));
            using HttpResponseMessage response = await client.SendAsync(request, voiceCancellation.Token);
            if (!response.IsSuccessStatusCode) return;
            string mime = response.Content.Headers.ContentType?.MediaType ?? "audio/mpeg";
            if (!mime.StartsWith("audio/", StringComparison.OrdinalIgnoreCase)) return;
            byte[] data = await response.Content.ReadAsByteArrayAsync(voiceCancellation.Token);
            if (data.Length is <= 0 or > 6_000_000) return;
            await form.ExecuteAsync("playVoice", new { mime, data = Convert.ToBase64String(data) });
        }
        catch
        {
            // Text chat remains usable when voice synthesis is unavailable.
        }
    }

    private static HttpRequestMessage CreateBridgeRequest(
        BridgeConfiguration configuration,
        string path,
        HttpContent content)
    {
        string agentId = Uri.EscapeDataString(configuration.Credential.AgentId);
        HttpRequestMessage request = new(HttpMethod.Post, configuration.SiteUrl + path + $"?agentId={agentId}")
        {
            Content = content
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration.Credential.Secret);
        request.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true, NoStore = true };
        return request;
    }

    private void AppendHistory(DesktopChatMessage message)
    {
        preferences.ChatHistory = preferences.ChatHistory.Append(message).TakeLast(12).ToList();
        DesktopPetPreferenceStore.Save(preferences);
    }

    private async Task FinishChatWithErrorAsync(string message)
    {
        conversationBusy = false;
        conversationForm.SetError(message);
        await form.ExecuteAsync("setConversationState", new { phase = "error", status = message });
    }

    private void CancelConversation()
    {
        conversationBusy = false;
        chatCancellation?.Cancel();
        voiceCancellation?.Cancel();
    }

    private string SpeciesName => preferences.Starter switch
    {
        "cool" => "曜影兽",
        "beautiful" => "月羽灵",
        _ => "绒云兽"
    };

    private string VoiceArchetype => preferences.Starter switch
    {
        "cool" => "edge",
        "beautiful" => "aether",
        _ => "sprout"
    };

    public void Dispose()
    {
        CancelConversation();
        chatCancellation?.Dispose();
        voiceCancellation?.Dispose();
        clickTimer.Stop();
        clickTimer.Dispose();
        mouseHook?.Dispose();
        conversationForm.ClosePermanently();
        client.Dispose();
        form.ClosePermanently();
    }
}

internal static class DesktopPetVisualSelfTest
{
    internal static void Run()
    {
        DesktopPetRuntime.ValidateAssets();
        using (DesktopPetConversationForm nativeConversation = new())
        {
            string? submittedText = null;
            nativeConversation.MessageSubmitted += text => submittedText = text;
            nativeConversation.SubmitForSelfTest("  hello   native  ");
            if (submittedText != "hello native")
            {
                throw new InvalidOperationException("Native desktop pet conversation did not accept text input.");
            }
        }
        DesktopPetPreferences preferences = new()
        {
            Visible = true,
            ClickThrough = false,
            Width = 340,
            Starter = "cute",
            Stage = "seed",
            Name = "露莫"
        };
        using ApplicationContext context = new();
        DesktopPetForm form = new(preferences);
        using System.Windows.Forms.Timer timeout = new() { Interval = 25_000 };
        Exception? failure = null;
        bool completed = false;
        int interactionPhase = 0;
        string lastNativeMessage = "none";

        void Complete(Exception? error)
        {
            if (completed) return;
            completed = true;
            failure = error;
            timeout.Stop();
            form.ClosePermanently();
            context.ExitThread();
        }

        timeout.Tick += (_, _) => Complete(new TimeoutException(
            $"Desktop pet self-test timed out (webview={form.IsRuntimeReady}, phase={interactionPhase}, last={lastNativeMessage})."));
        form.RuntimeError += message => Complete(new InvalidOperationException(message));
        form.NativeMessage += async message =>
        {
            if (!message.TryGetProperty("type", out JsonElement typeElement)) return;
            string type = typeElement.GetString() ?? string.Empty;
            lastNativeMessage = type;
            Console.WriteLine($"NEXORA desktop pet self-test message: {type}");
            try
            {
                if (type == "ready" && interactionPhase == 0)
                {
                    int opaquePixels = await form.SampleOpaquePixelsAsync();
                    bool transparentWindow = form.FormBorderStyle == FormBorderStyle.None &&
                        form.TopMost &&
                        form.TransparencyKey == Color.Fuchsia;
                    if (!transparentWindow || opaquePixels <= 100)
                    {
                        throw new InvalidOperationException(
                            $"Desktop pet visual probe failed (transparent={transparentWindow}, opaque={opaquePixels}).");
                    }
                    if (form.IsClickThroughStyleEnabled)
                    {
                        throw new InvalidOperationException("Desktop pet window unexpectedly has WS_EX_TRANSPARENT enabled.");
                    }
                    interactionPhase = 1;
                    await form.DispatchMouseClickAsync(1);
                    return;
                }

                if (type == "interaction" && interactionPhase == 1)
                {
                    interactionPhase = 2;
                    await Task.Delay(260);
                    await form.DispatchMouseClickAsync(2);
                    return;
                }

                if (type == "conversation-state" && interactionPhase == 2 &&
                    message.TryGetProperty("open", out JsonElement openElement) && openElement.GetBoolean())
                {
                    interactionPhase = 3;
                    form.ActivateConversation();
                    await Task.Delay(180);
                    if (!await form.IsConversationInputFocusedAsync())
                    {
                        throw new InvalidOperationException("Desktop pet conversation input did not receive focus.");
                    }
                    await form.TypeConversationMessageAsync("hello");
                    return;
                }

                if (type == "chat-submit" && interactionPhase == 3)
                {
                    string text = message.TryGetProperty("text", out JsonElement textElement)
                        ? textElement.GetString() ?? string.Empty
                        : string.Empty;
                    if (text != "hello")
                    {
                        throw new InvalidOperationException("Desktop pet conversation input changed the test message.");
                    }
                    Console.WriteLine("NEXORA desktop pet visual and native interaction probe passed");
                    Complete(null);
                }
            }
            catch (Exception error)
            {
                Complete(error);
            }
        };

        form.ShowPet();
        timeout.Start();
        Application.Run(context);
        if (failure is not null) throw failure;
    }
}

internal sealed class PetNameForm : Form
{
    private readonly TextBox nameInput = new();
    internal string PetName => nameInput.Text;

    internal PetNameForm(string currentName)
    {
        Text = "设置伙伴名字";
        Width = 390;
        Height = 170;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        Font = new Font("Microsoft YaHei UI", 10f);

        nameInput.Text = currentName;
        nameInput.MaxLength = 12;
        nameInput.Dock = DockStyle.Top;
        Button save = new() { Text = "保存", DialogResult = DialogResult.OK, AutoSize = true };
        Button cancel = new() { Text = "取消", DialogResult = DialogResult.Cancel, AutoSize = true };
        FlowLayoutPanel buttons = new()
        {
            Dock = DockStyle.Bottom,
            FlowDirection = FlowDirection.RightToLeft,
            Height = 44
        };
        buttons.Controls.Add(cancel);
        buttons.Controls.Add(save);
        Panel content = new() { Dock = DockStyle.Fill, Padding = new Padding(18) };
        content.Controls.Add(nameInput);
        content.Controls.Add(buttons);
        Controls.Add(content);
        AcceptButton = save;
        CancelButton = cancel;
    }
}
