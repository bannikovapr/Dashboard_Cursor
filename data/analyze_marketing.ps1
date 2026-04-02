$ErrorActionPreference = "Stop"

$j = Get-Content -Raw -Path "data/marketing.json" | ConvertFrom-Json

$rows = @()
foreach ($c in $j.channels) {
    $budget = [double]$c.totals.budget
    $leads = [double]$c.totals.leads
    $conv = [double]$c.totals.conversion
    $roas = [double]$c.totals.roas
    $cpl = if ($leads -gt 0) { $budget / $leads } else { [double]::PositiveInfinity }

    $rows += [pscustomobject]@{
        channel = [string]$c.channel
        budget = $budget
        leads = [int]$leads
        conversion = $conv
        roas = $roas
        cpl = $cpl
    }
}

Write-Output "period=$($j.period.start) - $($j.period.end)"
Write-Output "channels=$($rows.Count)"
Write-Output ""

Write-Output "by_roas_desc:"
$rows | Sort-Object roas -Descending | Format-Table channel,roas,cpl,conversion,leads,budget -AutoSize
Write-Output ""

Write-Output "by_cpl_asc:"
$rows | Sort-Object cpl | Format-Table channel,cpl,roas,conversion,leads,budget -AutoSize
Write-Output ""

Write-Output "by_budget_desc:"
$rows | Sort-Object budget -Descending | Format-Table channel,budget,leads,cpl,roas,conversion -AutoSize

Write-Output ""
Write-Output "overall:"
$totBudget = ($rows | Measure-Object -Property budget -Sum).Sum
$totLeads = ($rows | Measure-Object -Property leads -Sum).Sum
$weightedRoasSum = 0.0
foreach ($r in $rows) { $weightedRoasSum += ($r.budget * $r.roas) }
$avgCpl = if ($totLeads -gt 0) { $totBudget / $totLeads } else { 0.0 }
$wRoas = if ($totBudget -gt 0) { $weightedRoasSum / $totBudget } else { 0.0 }
Write-Output ("tot_budget=" + [math]::Round($totBudget, 2))
Write-Output ("tot_leads=" + [int]$totLeads)
Write-Output ("avg_cpl=" + [math]::Round($avgCpl, 2))
Write-Output ("weighted_roas=" + [math]::Round($wRoas, 4))
