#pragma once
#include "common.hpp"

namespace LensDesk {

class DCompEngine {
public:
    DCompEngine();
    ~DCompEngine();

    bool Initialize(HWND hwnd, ID3D11Device* d3dDevice, IDXGISwapChain1* swapChain);
    void Shutdown();

    void Commit();

    IDCompositionDevice* GetDevice() const { return m_dcompDevice.Get(); }
    IDCompositionTarget* GetTarget() const { return m_dcompTarget.Get(); }
    IDCompositionVisual* GetRootVisual() const { return m_rootVisual.Get(); }
    IDCompositionVisual* GetD3DVisual() const { return m_d3dVisual.Get(); }
    IDCompositionVisual* GetHudVisual() const { return m_hudVisual.Get(); }
    IDCompositionVisual* GetBrowserVisual() const { return m_browserVisual.Get(); }

    void SetHudVisualBounds(float x, float y, float width, float height);
    void SetBrowserVisualBounds(float x, float y, float width, float height);
    void SetBrowserVisualVisible(bool visible);

private:
    ComPtr<IDCompositionDevice> m_dcompDevice;
    ComPtr<IDCompositionTarget> m_dcompTarget;
    ComPtr<IDCompositionVisual> m_rootVisual;
    ComPtr<IDCompositionVisual> m_d3dVisual;
    ComPtr<IDCompositionVisual> m_hudVisual;
    ComPtr<IDCompositionVisual> m_browserVisual;

    bool m_browserVisible = false;
};

} // namespace LensDesk
