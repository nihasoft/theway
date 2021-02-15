process.argv.push('--the-way.core.log.enabled=false');
process.argv.push('--the-way.core.scan.enabled=false');

import { EnvironmentTest } from '../../resources/environment/environment.test';
import { Application, CORE, Inject, PropertyModel, TheWayApplication } from '../../../main';
import { DependentServiceTest } from '../../resources/injection/normal-dependency/dependent.service.test';

afterAll(() => {
    EnvironmentTest.clear();
});
beforeAll(() => {
    EnvironmentTest.spyProcessExit();
});
test('Injection: Manual scan', done => {
    const core = CORE.getCore();
    core.whenReady().subscribe(() => {
        const tree = core.getDependencyHandler().getDependenciesTree();
        const expectedTree = {
            DependencyAServiceTest: { DependencyBServiceTest: true },
            DependentServiceTest: { DependencyAServiceTest: { DependencyBServiceTest: true }, DependencyBServiceTest: true, Logger: true },
            Main: {
                DependentServiceTest: { DependencyAServiceTest: { DependencyBServiceTest: true }, DependencyBServiceTest: true, Logger: true }
            }
        };
        const instances = EnvironmentTest.getInstancesWithout(core, [Main]);
        const coreProperties = core.getPropertiesHandlder().getProperties('the-way.core') as PropertyModel;
        expect(instances.length).toBe(3);
        expect((coreProperties['scan'] as PropertyModel)['enabled']).toBeFalsy();
        expect((coreProperties['log'] as PropertyModel)['enabled']).toBeFalsy();
        expect(JSON.stringify(tree)).toBe(JSON.stringify(expectedTree));
        done();
    });
});
@Application()
export class Main extends TheWayApplication {
    /* Manual Injection force "scan" */
    @Inject dependent: DependentServiceTest;
}
