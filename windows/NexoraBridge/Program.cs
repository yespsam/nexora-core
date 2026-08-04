using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace NexoraBridge;

internal static class AppConstants
{
    internal const string ProductSite = "https://product-private-cloud-staging--nexora-core-staging.netlify.app";
    internal const string CredentialTarget = "NEXORA.CORE.DesktopCommandAgent";
    internal const string UserAgent = "NEXORA-Bridge-Windows/0.1";
}

internal static class JsonDefaults
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
}

internal sealed record BridgeCredential(
    int Version,
    string AgentId,
    string VaultId,
    string Secret,
    string? DisplayName);

internal sealed record BridgeConfiguration(
    int Version,
    string SiteUrl,
    BridgeCredential Credential);

internal static partial class PairingCode
{
    [GeneratedRegex("^[A-Za-z0-9_-]{22}$", RegexOptions.CultureInvariant)]
    private static partial Regex VaultIdPattern();

    [GeneratedRegex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)]
    private static partial Regex SecretPattern();

    internal static BridgeConfiguration? Parse(string? rawValue)
    {
        string[] parts = (rawValue ?? string.Empty).Trim().Split('.');
        if (parts.Length != 4 || parts[0] != "NXC1") return null;
        if (!Guid.TryParseExact(parts[1], "D", out Guid agentId)) return null;
        if (!VaultIdPattern().IsMatch(parts[2])) return null;
        if (!SecretPattern().IsMatch(parts[3])) return null;

        try
        {
            if (Base64Url.Decode(parts[3]).Length != 32) return null;
        }
        catch (FormatException)
        {
            return null;
        }

        return new BridgeConfiguration(
            1,
            AppConstants.ProductSite,
            new BridgeCredential(1, agentId.ToString("D").ToLowerInvariant(), parts[2], parts[3], "NEXORA Desktop"));
    }

    internal static BridgeConfiguration? Validate(BridgeConfiguration? configuration)
    {
        if (configuration is null || configuration.Version != 1 || configuration.SiteUrl != AppConstants.ProductSite)
        {
            return null;
        }

        BridgeCredential credential = configuration.Credential;
        return Parse($"NXC1.{credential.AgentId}.{credential.VaultId}.{credential.Secret}");
    }
}

internal static class Base64Url
{
    internal static byte[] Decode(string value)
    {
        string base64 = value.Replace('-', '+').Replace('_', '/');
        base64 += new string('=', (4 - base64.Length % 4) % 4);
        return Convert.FromBase64String(base64);
    }

    internal static string Encode(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

internal static class CredentialStore
{
    private const uint CredTypeGeneric = 1;
    private const uint CredPersistLocalMachine = 2;

    internal static void Save(BridgeConfiguration configuration)
    {
        Save(configuration, AppConstants.CredentialTarget);
    }

    internal static BridgeConfiguration? Load() => Load(AppConstants.CredentialTarget);

    internal static void Delete() => Delete(AppConstants.CredentialTarget);

    internal static void SaveForSelfTest(BridgeConfiguration configuration, string target)
    {
        EnsureSelfTestTarget(target);
        Save(configuration, target);
    }

    internal static BridgeConfiguration? LoadForSelfTest(string target)
    {
        EnsureSelfTestTarget(target);
        return Load(target);
    }

    internal static void DeleteForSelfTest(string target)
    {
        EnsureSelfTestTarget(target);
        Delete(target);
    }

    private static void Save(BridgeConfiguration configuration, string target)
    {
        byte[] blob = JsonSerializer.SerializeToUtf8Bytes(configuration, JsonDefaults.Options);
        if (blob.Length > 512) throw new InvalidOperationException("Credential is too large.");

        IntPtr blobPointer = Marshal.AllocCoTaskMem(blob.Length);
        try
        {
            Marshal.Copy(blob, 0, blobPointer, blob.Length);
            NativeCredential credential = new()
            {
                Type = CredTypeGeneric,
                TargetName = target,
                CredentialBlobSize = (uint)blob.Length,
                CredentialBlob = blobPointer,
                Persist = CredPersistLocalMachine,
                UserName = "NEXORA"
            };
            if (!CredWrite(ref credential, 0))
            {
                throw new InvalidOperationException($"Credential Manager rejected the credential ({Marshal.GetLastWin32Error()}).");
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(blob);
            Marshal.Copy(new byte[blob.Length], 0, blobPointer, blob.Length);
            Marshal.FreeCoTaskMem(blobPointer);
        }
    }

    private static BridgeConfiguration? Load(string target)
    {
        if (!CredRead(target, CredTypeGeneric, 0, out IntPtr pointer)) return null;
        try
        {
            NativeCredential credential = Marshal.PtrToStructure<NativeCredential>(pointer);
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0) return null;
            byte[] blob = new byte[checked((int)credential.CredentialBlobSize)];
            Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
            try
            {
                BridgeConfiguration? decoded = JsonSerializer.Deserialize<BridgeConfiguration>(blob, JsonDefaults.Options);
                return PairingCode.Validate(decoded);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(blob);
            }
        }
        finally
        {
            CredFree(pointer);
        }
    }

    private static void Delete(string target)
    {
        if (!CredDelete(target, CredTypeGeneric, 0))
        {
            int error = Marshal.GetLastWin32Error();
            const int ErrorNotFound = 1168;
            if (error != ErrorNotFound) throw new InvalidOperationException($"Credential deletion failed ({error}).");
        }
    }

    private static void EnsureSelfTestTarget(string target)
    {
        string prefix = AppConstants.CredentialTarget + ".SelfTest.";
        if (!target.StartsWith(prefix, StringComparison.Ordinal) ||
            !int.TryParse(target[prefix.Length..], out int processId) ||
            processId != Environment.ProcessId)
        {
            throw new InvalidOperationException("Invalid self-test credential target.");
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags;
        public uint Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string? TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string? Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string? TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredWrite(ref NativeCredential credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credential);
}

internal static class LegacyPairing
{
    internal static BridgeConfiguration? ImportIfPresent()
    {
        string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nexora", "bridge.json");
        if (!File.Exists(path)) return null;
        try
        {
            BridgeConfiguration? decoded = JsonSerializer.Deserialize<BridgeConfiguration>(File.ReadAllBytes(path), JsonDefaults.Options);
            BridgeConfiguration? configuration = PairingCode.Validate(decoded);
            if (configuration is null) return null;
            CredentialStore.Save(configuration);
            return configuration;
        }
        catch
        {
            return null;
        }
    }
}

internal sealed record CommandPayload(string Algorithm, string Iv, string Ciphertext);

internal sealed record CloudCommand(
    string CommandId,
    int Version,
    string AgentId,
    string VaultId,
    int KeyVersion,
    int ExpiresInSeconds,
    string CreatedAt,
    string ExpiresAt,
    string DeliveredAt,
    CommandPayload Payload);

internal sealed record ClaimResponse(CloudCommand? Command);

internal sealed record BridgeStatus(
    bool Enabled,
    bool Authenticated,
    string AgentId,
    string VaultId);

internal sealed record PairingVerification(bool Success, string Message);

internal static class PairingVerifier
{
    internal static async Task<PairingVerification> VerifyAsync(
        BridgeConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        try
        {
            using HttpClient client = new() { Timeout = TimeSpan.FromSeconds(12) };
            string agentId = Uri.EscapeDataString(configuration.Credential.AgentId);
            using HttpRequestMessage request = new(
                HttpMethod.Get,
                configuration.SiteUrl + $"/api/device-bridge/status?agentId={agentId}");
            request.Headers.Authorization = new AuthenticationHeaderValue(
                "Bearer",
                configuration.Credential.Secret);
            request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };

            using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                return new PairingVerification(false, "配对码无效、已撤销或没有完整复制，请回到伙伴页重新生成。");
            }
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                return new PairingVerification(false, "云端电脑助手当前未开启，请稍后重试。");
            }
            if (!response.IsSuccessStatusCode)
            {
                return new PairingVerification(false, $"云端验证失败（{(int)response.StatusCode}），请稍后重试。");
            }

            BridgeStatus? status = await response.Content.ReadFromJsonAsync<BridgeStatus>(
                JsonDefaults.Options,
                cancellationToken);
            if (status is null || !status.Enabled || !status.Authenticated ||
                status.AgentId != configuration.Credential.AgentId ||
                status.VaultId != configuration.Credential.VaultId)
            {
                return new PairingVerification(false, "云端返回了不匹配的电脑身份，请重新生成配对码。");
            }
            return new PairingVerification(true, "配对完成");
        }
        catch (TaskCanceledException)
        {
            return new PairingVerification(false, "连接云端超时，请检查网络后重试。");
        }
        catch (HttpRequestException)
        {
            return new PairingVerification(false, "无法连接 NEXORA CORE 云端，请检查网络、防火墙或代理设置。");
        }
        catch (JsonException)
        {
            return new PairingVerification(false, "云端验证响应无法识别，请下载最新版本后重试。");
        }
    }
}

internal sealed record CommandParameters(int? Level, int? Delta, string? App, string? Room, int? Degrees);

internal sealed record DeviceCommand(int Version, string Target, string Action, CommandParameters Parameters, string Label)
{
    internal bool IsAllowed
    {
        get
        {
            if (Version != 1 || Label.Length > 120) return false;
            if (Target == "computer")
            {
                return Action switch
                {
                    "volume.set" => Parameters.Level is >= 0 and <= 100,
                    "volume.change" => Parameters.Delta is -10 or 10,
                    "volume.mute" or "volume.unmute" or "media.play" or "media.pause" or "media.next" or "media.previous" => true,
                    "app.open" => Parameters.App is "safari" or "music" or "calendar" or "notes" or "calculator",
                    _ => false
                };
            }

            if (Target == "home")
            {
                if (Action is "light.on" or "light.off" or "curtain.open" or "curtain.close")
                {
                    return Parameters.Room is "客厅" or "卧室" or "书房" or "全屋";
                }
                return Action == "climate.set" && Parameters.Degrees is >= 16 and <= 30;
            }
            return false;
        }
    }
}

internal static class CommandCrypto
{
    internal static byte[] AdditionalData(string agentId, string vaultId) =>
        Encoding.UTF8.GetBytes($"nexora-device-command-v1:{agentId}:{vaultId}");

    internal static byte[] DeriveKey(BridgeCredential credential)
    {
        byte[] secret = Base64Url.Decode(credential.Secret);
        if (secret.Length != 32) throw new CryptographicException("Invalid credential.");
        try
        {
            return HKDF.DeriveKey(
                HashAlgorithmName.SHA256,
                secret,
                32,
                Encoding.UTF8.GetBytes("nexora-device-command-agent-v1"),
                AdditionalData(credential.AgentId, credential.VaultId));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(secret);
        }
    }

    internal static DeviceCommand Decrypt(CloudCommand envelope, BridgeCredential credential)
    {
        if (envelope.Version != 1 || envelope.KeyVersion != 1 || envelope.AgentId != credential.AgentId ||
            envelope.VaultId != credential.VaultId || envelope.Payload.Algorithm != "A256GCM")
        {
            throw new CryptographicException("Invalid envelope.");
        }

        byte[] nonce = Base64Url.Decode(envelope.Payload.Iv);
        byte[] combined = Base64Url.Decode(envelope.Payload.Ciphertext);
        if (nonce.Length != 12 || combined.Length < 17 || combined.Length > 16384)
        {
            throw new CryptographicException("Invalid envelope data.");
        }

        int ciphertextLength = combined.Length - 16;
        byte[] plaintext = new byte[ciphertextLength];
        byte[] key = DeriveKey(credential);
        byte[] additionalData = AdditionalData(credential.AgentId, credential.VaultId);
        try
        {
            using AesGcm aes = new(key, 16);
            aes.Decrypt(nonce, combined.AsSpan(0, ciphertextLength), combined.AsSpan(ciphertextLength, 16), plaintext, additionalData);
            DeviceCommand? command = JsonSerializer.Deserialize<DeviceCommand>(plaintext, JsonDefaults.Options);
            if (command is null || !command.IsAllowed) throw new CryptographicException("Disallowed command.");
            return command;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

}

internal static class WindowsCommandExecutor
{
    internal static bool Execute(DeviceCommand command)
    {
        if (!command.IsAllowed) return false;
        if (command.Target == "home") return true;

        try
        {
            return command.Action switch
            {
                "volume.set" => WindowsAudio.SetVolume(command.Parameters.Level!.Value / 100f),
                "volume.change" => WindowsAudio.ChangeVolume(command.Parameters.Delta!.Value / 100f),
                "volume.mute" => WindowsAudio.SetMute(true),
                "volume.unmute" => WindowsAudio.SetMute(false),
                "media.play" or "media.pause" => MediaKeys.Send(0xB3),
                "media.next" => MediaKeys.Send(0xB0),
                "media.previous" => MediaKeys.Send(0xB1),
                "app.open" => OpenApplication(command.Parameters.App!),
                _ => false
            };
        }
        catch
        {
            return false;
        }
    }

    private static bool OpenApplication(string app) => app switch
    {
        "safari" => Start(AppConstants.ProductSite + "/soulmate/"),
        "music" => Start("mswindowsmusic:"),
        "calendar" => Start("outlookcal:"),
        "notes" => Start("notepad.exe"),
        "calculator" => Start("calc.exe"),
        _ => false
    };

    private static bool Start(string fileName)
    {
        using Process? process = StartProcess(fileName);
        return process is not null;
    }

    internal static Process? LaunchNotesForSelfTest() => StartProcess("notepad.exe");

    private static Process? StartProcess(string fileName)
    {
        return Process.Start(new ProcessStartInfo
        {
            FileName = fileName,
            UseShellExecute = true,
            ErrorDialog = false
        });
    }
}

internal static class MediaKeys
{
    private const uint KeyEventKeyUp = 0x0002;

    internal static bool Send(byte virtualKey)
    {
        keybd_event(virtualKey, 0, 0, UIntPtr.Zero);
        keybd_event(virtualKey, 0, KeyEventKeyUp, UIntPtr.Zero);
        return true;
    }

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}

internal static class WindowsAudio
{
    internal static bool SetVolume(float value) => WithEndpoint(endpoint =>
    {
        Guid eventContext = Guid.Empty;
        Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(Math.Clamp(value, 0f, 1f), ref eventContext));
    });

    internal static bool ChangeVolume(float delta) => WithEndpoint(endpoint =>
    {
        endpoint.GetMasterVolumeLevelScalar(out float current);
        Guid eventContext = Guid.Empty;
        Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(Math.Clamp(current + delta, 0f, 1f), ref eventContext));
    });

    internal static bool SetMute(bool value) => WithEndpoint(endpoint =>
    {
        Guid eventContext = Guid.Empty;
        Marshal.ThrowExceptionForHR(endpoint.SetMute(value, ref eventContext));
    });

    internal static bool ProbeWithoutChangingState()
    {
        try
        {
            return WithEndpoint(endpoint =>
            {
                Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out float volume));
                Marshal.ThrowExceptionForHR(endpoint.GetMute(out bool muted));

                Guid eventContext = Guid.Empty;
                Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(volume, ref eventContext));
                eventContext = Guid.Empty;
                Marshal.ThrowExceptionForHR(endpoint.SetMute(muted, ref eventContext));
            });
        }
        catch
        {
            return false;
        }
    }

    private static bool WithEndpoint(Action<IAudioEndpointVolume> action)
    {
        IMMDeviceEnumerator? enumerator = null;
        IMMDevice? device = null;
        IAudioEndpointVolume? endpoint = null;
        try
        {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out device));
            Guid interfaceId = typeof(IAudioEndpointVolume).GUID;
            Marshal.ThrowExceptionForHR(device.Activate(ref interfaceId, ClsCtx.All, IntPtr.Zero, out object endpointObject));
            endpoint = (IAudioEndpointVolume)endpointObject;
            action(endpoint);
            return true;
        }
        finally
        {
            if (endpoint is not null) Marshal.FinalReleaseComObject(endpoint);
            if (device is not null) Marshal.FinalReleaseComObject(device);
            if (enumerator is not null) Marshal.FinalReleaseComObject(enumerator);
        }
    }

    private enum EDataFlow { Render, Capture, All }
    private enum ERole { Console, Multimedia, Communications }

    [Flags]
    private enum ClsCtx : uint
    {
        InprocServer = 0x1,
        InprocHandler = 0x2,
        LocalServer = 0x4,
        RemoteServer = 0x10,
        All = InprocServer | InprocHandler | LocalServer | RemoteServer
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, ClsCtx context, IntPtr activationParameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }

    [ComImport]
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid eventContext);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channelNumber, float level, ref Guid eventContext);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channelNumber, float level, ref Guid eventContext);
        [PreserveSig] int GetChannelVolumeLevel(uint channelNumber, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channelNumber, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        [PreserveSig] int GetVolumeStepInfo(out uint step, out uint stepCount);
        [PreserveSig] int VolumeStepUp(ref Guid eventContext);
        [PreserveSig] int VolumeStepDown(ref Guid eventContext);
        [PreserveSig] int QueryHardwareSupport(out uint mask);
        [PreserveSig] int GetVolumeRange(out float minimum, out float maximum, out float increment);
    }
}

internal sealed class BridgePoller : IDisposable
{
    private readonly HttpClient client;
    private CancellationTokenSource? cancellation;
    private int generation;

    internal event Action<string, bool>? StatusChanged;

    internal BridgePoller()
    {
        client = new HttpClient(new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            UseCookies = false
        })
        {
            Timeout = TimeSpan.FromSeconds(15)
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd(AppConstants.UserAgent);
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    internal void Start(BridgeConfiguration configuration)
    {
        Stop();
        int currentGeneration = generation;
        cancellation = new CancellationTokenSource();
        _ = Task.Run(() => RunAsync(configuration, currentGeneration, cancellation.Token));
    }

    internal void Stop()
    {
        Interlocked.Increment(ref generation);
        CancellationTokenSource? current = Interlocked.Exchange(ref cancellation, null);
        current?.Cancel();
        current?.Dispose();
    }

    private async Task RunAsync(BridgeConfiguration configuration, int currentGeneration, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await PollOnceAsync(configuration, currentGeneration, token);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                break;
            }
            catch (UnauthorizedAccessException)
            {
                Update(currentGeneration, "配对已失效", false);
            }
            catch
            {
                Update(currentGeneration, "连接中断，正在重试", false);
            }

            try
            {
                await Task.Delay(TimeSpan.FromMilliseconds(2500), token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task PollOnceAsync(BridgeConfiguration configuration, int currentGeneration, CancellationToken token)
    {
        string agentId = Uri.EscapeDataString(configuration.Credential.AgentId);
        using HttpRequestMessage request = CreateRequest(configuration, HttpMethod.Get, $"/api/device-bridge/commands?agentId={agentId}");
        using HttpResponseMessage response = await client.SendAsync(request, token);
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedAccessException();
        response.EnsureSuccessStatusCode();
        ClaimResponse? claimed = await response.Content.ReadFromJsonAsync<ClaimResponse>(JsonDefaults.Options, token);
        if (claimed?.Command is null)
        {
            Update(currentGeneration, "云端桌面客户端在线", true);
            return;
        }

        CloudCommand envelope = claimed.Command;
        bool succeeded = false;
        string label = "电脑指令";
        try
        {
            if (!DateTimeOffset.TryParse(envelope.ExpiresAt, out DateTimeOffset expiresAt) || expiresAt <= DateTimeOffset.UtcNow)
            {
                throw new InvalidOperationException("Expired command.");
            }
            DeviceCommand command = CommandCrypto.Decrypt(envelope, configuration.Credential);
            label = command.Label.Length <= 80 ? command.Label : command.Label[..80];
            succeeded = WindowsCommandExecutor.Execute(command);
        }
        catch
        {
            succeeded = false;
        }

        string commandId = Uri.EscapeDataString(envelope.CommandId);
        using HttpRequestMessage acknowledgement = CreateRequest(
            configuration,
            HttpMethod.Post,
            $"/api/device-bridge/commands/{commandId}/ack?agentId={agentId}",
            JsonContent.Create(new { outcome = succeeded ? "acknowledged" : "failed" }));
        using HttpResponseMessage accepted = await client.SendAsync(acknowledgement, token);
        accepted.EnsureSuccessStatusCode();
        Update(currentGeneration, succeeded ? $"已执行：{label}" : "已拒绝不安全或无效指令", true);
    }

    private static HttpRequestMessage CreateRequest(
        BridgeConfiguration configuration,
        HttpMethod method,
        string path,
        HttpContent? content = null)
    {
        HttpRequestMessage request = new(method, configuration.SiteUrl + path) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration.Credential.Secret);
        request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };
        return request;
    }

    private void Update(int currentGeneration, string text, bool online)
    {
        if (currentGeneration == generation) StatusChanged?.Invoke(text, online);
    }

    public void Dispose()
    {
        Stop();
        client.Dispose();
    }
}

internal sealed class PairingForm : Form
{
    private readonly TextBox pairingCode = new();

    internal string PairingCodeValue => pairingCode.Text;

    internal PairingForm()
    {
        Text = "配对 NEXORA CORE";
        Width = 560;
        Height = 230;
        MinimumSize = new Size(520, 220);
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        Font = new Font("Microsoft YaHei UI", 10f);

        Label instructions = new()
        {
            AutoSize = false,
            Dock = DockStyle.Fill,
            Text = "在伙伴页打开“设备 → 电脑助手 → 配对电脑”，复制配对码后粘贴到这里。\r\n配对码只会保存在这台电脑的 Windows 凭据管理器中。",
            Padding = new Padding(0, 4, 0, 0)
        };

        pairingCode.Dock = DockStyle.Fill;
        pairingCode.UseSystemPasswordChar = true;
        pairingCode.PlaceholderText = "NXC1...";
        pairingCode.MaxLength = 160;

        Button pair = new() { Text = "配对", DialogResult = DialogResult.OK, AutoSize = true };
        Button cancel = new() { Text = "取消", DialogResult = DialogResult.Cancel, AutoSize = true };
        FlowLayoutPanel buttons = new()
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false
        };
        buttons.Controls.Add(cancel);
        buttons.Controls.Add(pair);

        TableLayoutPanel layout = new()
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(20),
            ColumnCount = 1,
            RowCount = 3
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        layout.Controls.Add(instructions, 0, 0);
        layout.Controls.Add(pairingCode, 0, 1);
        layout.Controls.Add(buttons, 0, 2);
        Controls.Add(layout);
        AcceptButton = pair;
        CancelButton = cancel;
    }
}

internal sealed class TrayApplicationContext : ApplicationContext
{
    private readonly BridgePoller poller = new();
    private readonly NotifyIcon notifyIcon;
    private readonly Control dispatcher = new();
    private readonly ToolStripMenuItem statusItem;
    private readonly ToolStripMenuItem pairItem;
    private readonly ToolStripMenuItem pauseItem;
    private readonly ToolStripMenuItem removeItem;
    private BridgeConfiguration? configuration;
    private bool paused;

    internal TrayApplicationContext()
    {
        dispatcher.CreateControl();
        statusItem = new ToolStripMenuItem("正在启动") { Enabled = false };
        pairItem = new ToolStripMenuItem("配对电脑...", null, (_, _) => ShowPairing());
        pauseItem = new ToolStripMenuItem("暂停连接", null, (_, _) => TogglePaused()) { Enabled = false };
        removeItem = new ToolStripMenuItem("移除本机配对", null, (_, _) => RemovePairing()) { Enabled = false };

        ContextMenuStrip menu = new();
        menu.Items.Add(statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("打开 NEXORA CORE", null, (_, _) => OpenProduct()));
        menu.Items.Add(pairItem);
        menu.Items.Add(pauseItem);
        menu.Items.Add(removeItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("退出 NEXORA Bridge", null, (_, _) => ExitApplication()));

        notifyIcon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "NEXORA Bridge · 正在启动",
            ContextMenuStrip = menu,
            Visible = true
        };
        notifyIcon.DoubleClick += (_, _) => OpenProduct();
        poller.StatusChanged += (text, online) => dispatcher.BeginInvoke(new Action(() => UpdateStatus(text, online)));

        configuration = CredentialStore.Load() ?? LegacyPairing.ImportIfPresent();
        if (configuration is not null)
        {
            Start(configuration);
        }
        else
        {
            UpdateStatus("尚未配对", false);
            dispatcher.BeginInvoke(new Action(ShowPairing));
        }
    }

    private void Start(BridgeConfiguration value)
    {
        configuration = value;
        paused = false;
        pairItem.Text = "重新配对...";
        pauseItem.Text = "暂停连接";
        pauseItem.Enabled = true;
        removeItem.Enabled = true;
        UpdateStatus("正在连接", false);
        poller.Start(value);
    }

    private void UpdateStatus(string text, bool online)
    {
        statusItem.Text = text;
        notifyIcon.Text = Truncate($"NEXORA Bridge · {text}", 63);
        notifyIcon.Icon = online ? SystemIcons.Shield : SystemIcons.Application;
    }

    private void OpenProduct() => WindowsCommandExecutor.Execute(new DeviceCommand(
        1,
        "computer",
        "app.open",
        new CommandParameters(null, null, "safari", null, null),
        "打开 NEXORA CORE"));

    private async void ShowPairing()
    {
        while (true)
        {
            using PairingForm form = new();
            if (form.ShowDialog() != DialogResult.OK) return;
            BridgeConfiguration? parsed = PairingCode.Parse(form.PairingCodeValue);
            if (parsed is null)
            {
                MessageBox.Show("请重新从 NEXORA CORE 伙伴页复制完整配对码。", "配对码无效", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                continue;
            }

            UpdateStatus("正在验证配对码", false);
            PairingVerification verification = await PairingVerifier.VerifyAsync(parsed);
            if (!verification.Success)
            {
                UpdateStatus(configuration is null ? "尚未配对" : "原配对仍在使用", false);
                MessageBox.Show(verification.Message, "配对未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                continue;
            }

            try
            {
                CredentialStore.Save(parsed);
                Start(parsed);
                MessageBox.Show(
                    "配对完成。NEXORA Bridge 已在 Windows 右下角系统托盘保持在线。",
                    "NEXORA CORE",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return;
            }
            catch
            {
                UpdateStatus(configuration is null ? "尚未配对" : "原配对仍在使用", false);
                MessageBox.Show("Windows 凭据管理器没有接受这条凭据。", "无法保存配对", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }

    private void TogglePaused()
    {
        if (configuration is null) return;
        paused = !paused;
        if (paused)
        {
            poller.Stop();
            pauseItem.Text = "恢复连接";
            UpdateStatus("已暂停", false);
        }
        else
        {
            Start(configuration);
        }
    }

    private void RemovePairing()
    {
        DialogResult answer = MessageBox.Show(
            "本机将停止领取电脑控制指令。之后需要重新输入配对码才能连接。",
            "移除这台 Windows 电脑的配对？",
            MessageBoxButtons.OKCancel,
            MessageBoxIcon.Warning);
        if (answer != DialogResult.OK) return;

        try
        {
            CredentialStore.Delete();
            poller.Stop();
            configuration = null;
            pairItem.Text = "配对电脑...";
            pauseItem.Enabled = false;
            removeItem.Enabled = false;
            UpdateStatus("尚未配对", false);
        }
        catch
        {
            MessageBox.Show("请检查 Windows 凭据管理器权限后重试。", "无法移除配对", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void ExitApplication()
    {
        poller.Dispose();
        notifyIcon.Visible = false;
        notifyIcon.Dispose();
        dispatcher.Dispose();
        ExitThread();
    }

    private static string Truncate(string value, int maximum) => value.Length <= maximum ? value : value[..maximum];
}

internal static class SelfTest
{
    internal static void Run(bool includeNativeActions = false)
    {
        string secret = Base64Url.Encode(Enumerable.Repeat((byte)7, 32).ToArray());
        string agentId = "038641cf-d9ff-491a-a199-bd9f0a07a48c";
        string vaultId = "q58whe6p3uNgkG7FBi70Ww";
        BridgeConfiguration configuration = PairingCode.Parse($"NXC1.{agentId}.{vaultId}.{secret}")
            ?? throw new InvalidOperationException("Pairing parser failed.");
        CloudCommand envelope = new(
            "0c51d146-3c73-4dc5-874b-c3035d07a9f0",
            1,
            agentId,
            vaultId,
            1,
            120,
            "2026-08-02T00:00:00Z",
            "2099-08-02T00:02:00Z",
            "2026-08-02T00:00:01Z",
            new CommandPayload(
                "A256GCM",
                "AwMDAwMDAwMDAwMD",
                "oEHSKK31e_6lDMZbBS09AwjAZuWHb03bt8lfGpJAO4tOjgvIFCSUmsV6tXU1F6pgaskZ485FF4ibdiilgIV7SAGkRtBD5QRjXjntiaRrxvOdDBF-g4Zg7_pdEYI686C3XBUbCH5vzeiXf6mXcSycxUgr_pYbNiCZowyGGTJ7_jdN2YHOQJ-E"));
        DeviceCommand decrypted = CommandCrypto.Decrypt(envelope, configuration.Credential);
        if (decrypted.Action != "app.open" || decrypted.Parameters.App != "calculator")
        {
            throw new InvalidOperationException("Encrypted command round trip failed.");
        }
        DeviceCommand unsafeCommand = new(1, "computer", "shell.execute", new CommandParameters(null, null, null, null, null), "unsafe");
        if (unsafeCommand.IsAllowed) throw new InvalidOperationException("Command allowlist failed.");
        VerifyCredentialManager(configuration);
        using PairingForm pairingForm = new();
        if (pairingForm.AcceptButton is null || pairingForm.CancelButton is null || pairingForm.Controls.Count == 0)
        {
            throw new InvalidOperationException("Pairing window initialization failed.");
        }
        if (includeNativeActions) VerifyNativeActions();
        Console.WriteLine("NEXORA Bridge Windows self-test passed");
    }

    private static void VerifyNativeActions()
    {
        using Process process = WindowsCommandExecutor.LaunchNotesForSelfTest()
            ?? throw new InvalidOperationException("Allowlisted application launch failed.");
        try
        {
            try
            {
                process.WaitForInputIdle(3000);
            }
            catch (InvalidOperationException)
            {
                // Some packaged Windows apps hand off to another process immediately.
            }

            if (process.HasExited && process.ExitCode != 0)
            {
                throw new InvalidOperationException($"Allowlisted application exited with code {process.ExitCode}.");
            }
        }
        finally
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(5000);
            }
        }

        Console.WriteLine("NEXORA Bridge Windows allowlisted application launch passed");
        Console.WriteLine(WindowsAudio.ProbeWithoutChangingState()
            ? "NEXORA Bridge Windows audio endpoint probe passed"
            : "NEXORA Bridge Windows audio endpoint probe skipped: no endpoint");
    }

    private static void VerifyCredentialManager(BridgeConfiguration configuration)
    {
        string target = $"{AppConstants.CredentialTarget}.SelfTest.{Environment.ProcessId}";
        try
        {
            CredentialStore.DeleteForSelfTest(target);
            CredentialStore.SaveForSelfTest(configuration, target);
            BridgeConfiguration? loaded = CredentialStore.LoadForSelfTest(target);
            if (loaded != configuration) throw new InvalidOperationException("Credential Manager round trip failed.");
        }
        finally
        {
            CredentialStore.DeleteForSelfTest(target);
        }
        if (CredentialStore.LoadForSelfTest(target) is not null)
        {
            throw new InvalidOperationException("Credential Manager self-test cleanup failed.");
        }
    }
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool nativeSelfTest = args.Contains("--self-test-native", StringComparer.Ordinal);
        if (nativeSelfTest || args.Contains("--self-test", StringComparer.Ordinal))
        {
            try
            {
                SelfTest.Run(nativeSelfTest);
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"NEXORA Bridge Windows self-test failed: {error.Message}");
                return 1;
            }
        }

        using Mutex singleInstance = new(true, "Local\\NEXORA.CORE.Bridge", out bool createdNew);
        if (!createdNew)
        {
            MessageBox.Show("NEXORA Bridge 已经在运行。", "NEXORA Bridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        Application.Run(new TrayApplicationContext());
        return 0;
    }
}
