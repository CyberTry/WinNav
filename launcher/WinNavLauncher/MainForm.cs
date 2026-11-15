using System.Diagnostics;
using System.Text;

namespace WinNavLauncher;

/// <summary>
/// WinNav 启动器主窗口：
/// - 启动 / 停止 WinNav.exe（与启动器同目录）
/// - 更改服务端口（写入同目录 .env 的 PORT=，保存后自动重启生效）
/// - 开放 Windows 防火墙入站端口（调用 netsh，需要管理员权限）
/// </summary>
public class MainForm : Form
{
    private readonly string _appDir = AppContext.BaseDirectory;
    private readonly string _exePath;
    private Process? _process;
    private readonly System.Windows.Forms.Timer _pollTimer;

    private Button _toggleButton = null!;
    private Button _openHomeButton = null!;
    private Button _applyPortButton = null!;
    private Button _firewallButton = null!;
    private Label _statusLabel = null!;
    private LinkLabel _urlLabel = null!;
    private TextBox _portBox = null!;
    private Label _pathLabel = null!;

    public MainForm()
    {
        _exePath = Path.Combine(_appDir, "WinNav.exe");

        Text = "WinNav 启动器";
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 340);
        Font = new Font("Microsoft YaHei UI", 9F);

        _pathLabel = new Label
        {
            Dock = DockStyle.Top,
            Height = 28,
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(12, 8, 0, 0),
            AutoEllipsis = true,
            ForeColor = Color.DimGray
        };

        var serviceBox = BuildServiceGroup();
        var portBox = BuildPortGroup();
        var firewallBox = BuildFirewallGroup();

        Controls.Add(firewallBox);
        Controls.Add(portBox);
        Controls.Add(serviceBox);
        Controls.Add(_pathLabel);

        _pollTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _pollTimer.Tick += (_, _) => PollProcess();
        _pollTimer.Start();

        Load += (_, _) =>
        {
            _pathLabel.Text = "程序：" + _exePath;
            _portBox.Text = ReadPort().ToString();
            TryAttachExistingProcess();
            UpdateUi();
        };

        FormClosed += (_, _) => _pollTimer.Stop();
    }

    // ================= UI 构建 =================

    private GroupBox BuildServiceGroup()
    {
        var box = new GroupBox
        {
            Text = "服务控制",
            Location = new Point(12, 34),
            Size = new Size(436, 108)
        };

        _toggleButton = new Button
        {
            Text = "启动服务",
            Location = new Point(20, 34),
            Size = new Size(150, 46)
        };
        _toggleButton.Click += (_, _) => ToggleService();

        _openHomeButton = new Button
        {
            Text = "打开首页",
            Location = new Point(186, 34),
            Size = new Size(110, 46)
        };
        _openHomeButton.Click += (_, _) => OpenHome();

        _statusLabel = new Label
        {
            Text = "● 已停止",
            Location = new Point(310, 40),
            Size = new Size(110, 24),
            ForeColor = Color.Firebrick,
            Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold)
        };

        _urlLabel = new LinkLabel
        {
            Text = "",
            Location = new Point(310, 66),
            Size = new Size(120, 20)
        };
        _urlLabel.LinkClicked += (_, _) => OpenHome();

        box.Controls.AddRange(new Control[] { _toggleButton, _openHomeButton, _statusLabel, _urlLabel });
        return box;
    }

    private GroupBox BuildPortGroup()
    {
        var box = new GroupBox
        {
            Text = "端口设置",
            Location = new Point(12, 150),
            Size = new Size(436, 92)
        };

        var label = new Label
        {
            Text = "服务端口：",
            Location = new Point(20, 36),
            Size = new Size(80, 24)
        };

        _portBox = new TextBox
        {
            Location = new Point(104, 33),
            Size = new Size(110, 26)
        };

        _applyPortButton = new Button
        {
            Text = "保存并应用",
            Location = new Point(232, 31),
            Size = new Size(120, 32)
        };
        _applyPortButton.Click += (_, _) => ApplyPort();

        var hint = new Label
        {
            Text = "修改端口会写入 .env 并自动重启服务",
            Location = new Point(20, 62),
            Size = new Size(400, 20),
            ForeColor = Color.DimGray
        };

        box.Controls.AddRange(new Control[] { label, _portBox, _applyPortButton, hint });
        return box;
    }

    private GroupBox BuildFirewallGroup()
    {
        var box = new GroupBox
        {
            Text = "网络",
            Location = new Point(12, 250),
            Size = new Size(436, 80)
        };

        _firewallButton = new Button
        {
            Text = "开放防火墙端口",
            Location = new Point(20, 30),
            Size = new Size(170, 34)
        };
        _firewallButton.Click += (_, _) => OpenFirewall();

        var hint = new Label
        {
            Text = "允许局域网其他设备访问（需要管理员权限）",
            Location = new Point(206, 38),
            Size = new Size(220, 20),
            ForeColor = Color.DimGray
        };

        box.Controls.AddRange(new Control[] { _firewallButton, hint });
        return box;
    }

    // ================= 服务控制 =================

    private void ToggleService()
    {
        try
        {
            if (IsRunning)
            {
                StopService();
            }
            else
            {
                StartService();
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "操作失败：" + ex.Message, "WinNav", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        UpdateUi();
    }

    private bool IsRunning => _process is { HasExited: false };

    private void StartService()
    {
        if (!File.Exists(_exePath))
        {
            MessageBox.Show(this, "未找到 WinNav.exe：\n" + _exePath + "\n请将启动器放在 WinNav.exe 同目录下。", "WinNav",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = _exePath,
            WorkingDirectory = Path.GetDirectoryName(_exePath)!,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        _process = Process.Start(psi);
    }

    private void StopService()
    {
        if (_process == null) return;
        if (!_process.HasExited)
        {
            _process.Kill(entireProcessTree: true);
            _process.WaitForExit(5000);
        }
        _process.Dispose();
        _process = null;
    }

    /// <summary>启动器打开时，如果 WinNav 已在运行则接管它（不重复拉起）。</summary>
    private void TryAttachExistingProcess()
    {
        foreach (var p in Process.GetProcessesByName("WinNav"))
        {
            try
            {
                var dir = Path.GetDirectoryName(p.MainModule?.FileName);
                if (string.Equals(dir, _appDir, StringComparison.OrdinalIgnoreCase))
                {
                    _process = p;
                    break;
                }
            }
            catch
            {
                // MainModule 需要额外权限；忽略后继续扫描
            }
        }
    }

    private void PollProcess()
    {
        // 进程意外退出时自动刷新界面状态
        if (_process is { HasExited: true })
        {
            _process.Dispose();
            _process = null;
            UpdateUi();
        }
    }

    // ================= 端口 =================

    private int ReadPort()
    {
        foreach (var raw in ReadEnvLines())
        {
            var line = raw.Trim();
            if (line.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase))
            {
                if (int.TryParse(line[5..].Trim(), out var port) && port is >= 1 and <= 65535)
                    return port;
                break;
            }
        }
        return 8080;
    }

    private IEnumerable<string> ReadEnvLines()
    {
        var envPath = Path.Combine(_appDir, ".env");
        return File.Exists(envPath) ? File.ReadAllLines(envPath) : Enumerable.Empty<string>();
    }

    private void ApplyPort()
    {
        if (!int.TryParse(_portBox.Text.Trim(), out var port) || port is < 1 or > 65535)
        {
            MessageBox.Show(this, "端口号必须是 1~65535 之间的整数。", "WinNav", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        try
        {
            WriteEnvPort(port);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "写入 .env 失败：" + ex.Message, "WinNav", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        // 若服务正在运行则重启以生效
        if (IsRunning)
        {
            StopService();
            StartService();
        }

        _portBox.Text = port.ToString();
        UpdateUi();
        MessageBox.Show(this, "端口已更新为 " + port + "。", "WinNav", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void WriteEnvPort(int port)
    {
        var envPath = Path.Combine(_appDir, ".env");
        var lines = ReadEnvLines().ToList();

        var replaced = false;
        for (var i = 0; i < lines.Count; i++)
        {
            var t = lines[i].Trim();
            if (t.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase))
            {
                lines[i] = "PORT=" + port;
                replaced = true;
                break;
            }
        }
        if (!replaced) lines.Add("PORT=" + port);

        // 临时文件 + 替换，避免写入中断导致配置损坏
        var tmp = envPath + ".tmp";
        File.WriteAllLines(tmp, lines, new UTF8Encoding(false));
        File.Move(tmp, envPath, overwrite: true);
    }

    // ================= 防火墙 =================

    private void OpenFirewall()
    {
        if (!int.TryParse(_portBox.Text.Trim(), out var port) || port is < 1 or > 65535)
        {
            MessageBox.Show(this, "端口号必须是 1~65535 之间的整数。", "WinNav", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var args = $"advfirewall firewall add rule name=\"WinNav\" dir=in action=allow protocol=TCP localport={port}";
        try
        {
            using var p = Process.Start(new ProcessStartInfo("netsh", args)
            {
                Verb = "runas",          // 弹出 UAC 提权
                UseShellExecute = true,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
            p?.WaitForExit();
            MessageBox.Show(this, "防火墙规则已添加：允许 TCP " + port + " 端口入站。", "WinNav",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // 用户在 UAC 弹窗中点了“否”
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "添加防火墙规则失败：" + ex.Message, "WinNav", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    // ================= 其他 =================

    private void OpenHome()
    {
        try
        {
            var port = int.TryParse(_portBox.Text.Trim(), out var p) && p is >= 1 and <= 65535 ? p : ReadPort();
            Process.Start(new ProcessStartInfo("http://127.0.0.1:" + port) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "打开浏览器失败：" + ex.Message, "WinNav", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void UpdateUi()
    {
        var running = IsRunning;
        _toggleButton.Text = running ? "停止服务" : "启动服务";
        _statusLabel.Text = running ? "● 运行中" : "● 已停止";
        _statusLabel.ForeColor = running ? Color.ForestGreen : Color.Firebrick;

        var port = int.TryParse(_portBox.Text.Trim(), out var p) && p is >= 1 and <= 65535 ? p : ReadPort();
        _urlLabel.Text = "http://127.0.0.1:" + port;
        _openHomeButton.Enabled = true;
    }
}
